package main

import (
	"bytes"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	nativeclipboard "github.com/aymanbagabas/go-nativeclipboard"
	"github.com/gabriel-vasile/mimetype"
	"github.com/spf13/viper"
)

type UploadResponse struct {
	Code        int    `json:"Code"`
	Message     string `json:"Message"`
	URL         string `json:"url,omitempty"`
	ObjectID    string `json:"objectId,omitempty"`
	SessionID   string `json:"sessionId,omitempty"`
	ChunkIndex  int64  `json:"chunkIndex,omitempty"`
	TotalChunks int64  `json:"totalChunks,omitempty"`
}

type UploadOptions struct {
	Path          string
	Tags          []string
	CollectionIDs []string
	Description   string
}

func uploadFile(filePath string, uploadType string, opts UploadOptions) (UploadResponse, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return UploadResponse{}, fmt.Errorf("open file: %w", err)
	}
	defer file.Close()

	fileInfo, err := file.Stat()
	if err != nil {
		return UploadResponse{}, fmt.Errorf("stat file: %w", err)
	}

	fileSize := fileInfo.Size()
	chunkSize := int64(viper.GetInt("general.MAX_CHUNK_SIZE") * 1024 * 1024)
	if chunkSize <= 0 {
		chunkSize = 20 * 1024 * 1024
	}

	mtype, err := mimetype.DetectFile(filePath)
	if err != nil {
		return UploadResponse{}, fmt.Errorf("detect MIME type: %w", err)
	}
	detectedMimeType := mtype.String()
	if verbose {
		fmt.Printf("Detected MIME type: %s\n", detectedMimeType)
	}

	if uploadType == "image" {
		if !strings.HasPrefix(detectedMimeType, "image/") {
			return UploadResponse{}, fmt.Errorf("file is not a recognized image format: %s", detectedMimeType)
		}

		maxImageSize := int64(viper.GetInt("image.MAX_IMAGE_SIZE") * 1024 * 1024)
		if maxImageSize <= 0 {
			maxImageSize = 10 * 1024 * 1024
		}
		if fileSize > maxImageSize {
			return UploadResponse{}, fmt.Errorf("image size %d bytes exceeds maximum %d bytes", fileSize, maxImageSize)
		}
	}

	if fileSize <= chunkSize {
		return uploadSingleFile(file, filePath, uploadType, detectedMimeType, opts)
	}
	return uploadChunkedFile(file, filePath, fileSize, chunkSize, detectedMimeType, opts)
}

func uploadSingleFile(file *os.File, filePath string, uploadType string, mimeType string, opts UploadOptions) (UploadResponse, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fileInfo, err := file.Stat()
	if err != nil {
		return UploadResponse{}, err
	}

	fieldName := "file"
	endpoint := "upload"
	if uploadType == "image" {
		fieldName = "image"
		endpoint = "upload/image"
	}

	part, err := writer.CreateFormFile(fieldName, filepath.Base(filePath))
	if err != nil {
		return UploadResponse{}, err
	}
	if _, err := io.Copy(part, file); err != nil {
		return UploadResponse{}, err
	}
	if err := writer.WriteField("objectType", mimeType); err != nil {
		return UploadResponse{}, err
	}
	if err := writer.WriteField("objectName", filepath.Base(filePath)); err != nil {
		return UploadResponse{}, err
	}
	if err := writer.WriteField("objectSize", strconv.FormatInt(fileInfo.Size(), 10)); err != nil {
		return UploadResponse{}, err
	}
	if err := writeUploadOptionFields(writer, opts); err != nil {
		return UploadResponse{}, err
	}
	if err := writer.Close(); err != nil {
		return UploadResponse{}, err
	}

	var result UploadResponse
	if err := doMultipart(endpoint, body, writer, &result); err != nil {
		return UploadResponse{}, err
	}
	printUploadResult(result)
	return result, nil
}

func uploadChunkedFile(file *os.File, filePath string, fileSize, chunkSize int64, mimeType string, opts UploadOptions) (UploadResponse, error) {
	totalChunks := (fileSize + chunkSize - 1) / chunkSize

	objectID, err := initUpload(filePath, fileSize, totalChunks, chunkSize, mimeType, opts)
	if err != nil {
		return UploadResponse{}, fmt.Errorf("initialize upload: %w", err)
	}

	var finalResult UploadResponse
	for i := int64(0); i < totalChunks; i++ {
		startByte := i * chunkSize
		endByte := min(startByte+chunkSize, fileSize)
		currentChunkSize := endByte - startByte

		result, err := uploadChunk(file, filePath, objectID, i, totalChunks, startByte, currentChunkSize, mimeType)
		if err != nil {
			return UploadResponse{}, fmt.Errorf("upload chunk %d: %w", i+1, err)
		}
		finalResult = result
		if !jsonOutput {
			fmt.Printf("Uploaded chunk %d of %d\n", i+1, totalChunks)
		}
	}

	printUploadResult(finalResult)
	return finalResult, nil
}

func initUpload(filePath string, fileSize, totalChunks, chunkSize int64, mimeType string, opts UploadOptions) (string, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	objectName := filepath.Base(filePath)
	fields := map[string]string{
		"objectName":  objectName,
		"objectSize":  strconv.FormatInt(fileSize, 10),
		"totalChunks": strconv.FormatInt(totalChunks, 10),
		"chunkSize":   strconv.FormatInt(chunkSize, 10),
		"objectType":  mimeType,
	}
	for name, value := range fields {
		if err := writer.WriteField(name, value); err != nil {
			return "", err
		}
	}
	if err := writeUploadOptionFields(writer, opts); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}

	var result UploadResponse
	if err := doMultipart("upload", body, writer, &result); err != nil {
		return "", err
	}
	if result.ObjectID == "" {
		return "", fmt.Errorf("server did not return objectId")
	}
	if verbose && !jsonOutput {
		fmt.Printf("Initialized upload with objectID: %s\n", result.ObjectID)
	}
	return result.ObjectID, nil
}

func uploadChunk(file *os.File, filePath, objectID string, chunkIndex, totalChunks, startByte, chunkSize int64, mimeType string) (UploadResponse, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	fields := map[string]string{
		"isChunk":     "true",
		"chunkIndex":  strconv.FormatInt(chunkIndex, 10),
		"totalChunks": strconv.FormatInt(totalChunks, 10),
		"objectId":    objectID,
		"objectName":  filepath.Base(filePath),
		"objectType":  mimeType,
		"chunkSize":   strconv.FormatInt(chunkSize, 10),
	}
	for name, value := range fields {
		if err := writer.WriteField(name, value); err != nil {
			return UploadResponse{}, err
		}
	}

	part, err := writer.CreateFormFile("file", fmt.Sprintf("%s.part%d", filepath.Base(filePath), chunkIndex))
	if err != nil {
		return UploadResponse{}, err
	}
	if _, err := file.Seek(startByte, 0); err != nil {
		return UploadResponse{}, err
	}
	if _, err := io.CopyN(part, file, chunkSize); err != nil {
		return UploadResponse{}, err
	}
	if err := writer.Close(); err != nil {
		return UploadResponse{}, err
	}

	var result UploadResponse
	if err := doMultipart("upload", body, writer, &result); err != nil {
		return UploadResponse{}, err
	}
	return result, nil
}

func uploadImageFromClipboard(opts UploadOptions) error {
	imageData, err := nativeclipboard.Image.Read()
	if err == nil && len(imageData) > 0 {
		return uploadImageData(imageData, opts)
	}
	fallbackData, fallbackErr := readClipboardImageWithMacOSFallback()
	if fallbackErr == nil && len(fallbackData) > 0 {
		return uploadImageData(fallbackData, opts)
	}
	if err != nil {
		return fmt.Errorf("read clipboard image: %w; macOS fallback: %v", err, fallbackErr)
	}
	return fmt.Errorf("clipboard does not contain image data; macOS fallback: %v", fallbackErr)
}

func readClipboardImageWithMacOSFallback() ([]byte, error) {
	if runtime.GOOS != "darwin" {
		return nil, fmt.Errorf("unsupported platform")
	}

	tmpDir, err := os.MkdirTemp("", "filecubby-clipboard-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmpDir)

	outPath := filepath.Join(tmpDir, "clipboard.png")
	script := `
set outPath to POSIX file "` + strings.ReplaceAll(outPath, `"`, `\"`) + `"
try
  set pngData to the clipboard as «class PNGf»
  set fileRef to open for access outPath with write permission
  set eof fileRef to 0
  write pngData to fileRef
  close access fileRef
on error errMsg number errNum
  try
    close access outPath
  end try
  error errMsg number errNum
end try
`
	if output, err := exec.Command("osascript", "-e", script).CombinedOutput(); err != nil {
		return nil, fmt.Errorf("osascript failed: %w: %s", err, strings.TrimSpace(string(output)))
	}

	data, err := os.ReadFile(outPath)
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("osascript produced empty image")
	}
	return data, nil
}

func writeUploadOptionFields(writer *multipart.Writer, opts UploadOptions) error {
	if opts.Path != "" {
		if err := writer.WriteField("path", opts.Path); err != nil {
			return err
		}
	}
	if len(opts.Tags) > 0 {
		if err := writer.WriteField("tags", strings.Join(opts.Tags, ",")); err != nil {
			return err
		}
	}
	if len(opts.CollectionIDs) > 0 {
		if err := writer.WriteField("collectionIds", strings.Join(opts.CollectionIDs, ",")); err != nil {
			return err
		}
	}
	if opts.Description != "" {
		if err := writer.WriteField("description", opts.Description); err != nil {
			return err
		}
	}
	return nil
}

func uploadImageData(imageData []byte, opts UploadOptions) error {
	mtype, err := mimetype.DetectReader(bytes.NewReader(imageData))
	if err != nil {
		return fmt.Errorf("detect MIME type: %w", err)
	}
	mimeType := mtype.String()
	if !strings.HasPrefix(mimeType, "image/") {
		return fmt.Errorf("clipboard content is not a recognized image format: %s", mimeType)
	}

	maxImageSize := int64(viper.GetInt("image.MAX_IMAGE_SIZE") * 1024 * 1024)
	if maxImageSize <= 0 {
		maxImageSize = 10 * 1024 * 1024
	}
	if int64(len(imageData)) > maxImageSize {
		return fmt.Errorf("image size %d bytes exceeds maximum %d bytes", len(imageData), maxImageSize)
	}

	extension := ".bin"
	if exts, err := mime.ExtensionsByType(mimeType); err == nil && len(exts) > 0 {
		extension = exts[0]
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("image", "clipboard-image"+extension)
	if err != nil {
		return err
	}
	if _, err := part.Write(imageData); err != nil {
		return err
	}
	if err := writer.WriteField("objectType", mimeType); err != nil {
		return err
	}
	if err := writer.WriteField("objectName", "clipboard-image"+extension); err != nil {
		return err
	}
	if err := writer.WriteField("objectSize", strconv.Itoa(len(imageData))); err != nil {
		return err
	}
	if err := writeUploadOptionFields(writer, opts); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}

	var result UploadResponse
	if err := doMultipart("upload/image", body, writer, &result); err != nil {
		return err
	}
	printUploadResult(result)
	return nil
}

func printUploadResult(result UploadResponse) {
	if jsonOutput {
		_ = printJSON(result)
		return
	}
	if result.URL != "" {
		fmt.Printf("Uploaded successfully: %s\n", result.URL)
		return
	}
	fmt.Printf("Uploaded successfully. Object ID: %s\n", result.ObjectID)
}

func min(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
