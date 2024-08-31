package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httputil"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	"github.com/gabriel-vasile/mimetype"
	"github.com/spf13/viper"
	"golang.design/x/clipboard"
)

type UploadResponse struct {
	Code      int    `json:"Code"`
	Message   string `json:"Message"`
	URL       string `json:"url"`
	FileID    string `json:"fileId"`
	SessionID string `json:"sessionId"`
}

func uploadFile(filePath string, uploadType string, verbose bool) {
	file, err := os.Open(filePath)
	if err != nil {
		fmt.Printf("Error opening file: %s\n", err)
		return
	}
	defer file.Close()

	fileInfo, err := file.Stat()
	if err != nil {
		fmt.Printf("Error getting file info: %s\n", err)
		return
	}

	fileSize := fileInfo.Size()
	chunkSize := int64(viper.GetInt("general.MAX_CHUNK_SIZE") * 1024 * 1024)

	if fileSize <= chunkSize {
		uploadSingleFile(file, filePath, fileSize, uploadType, verbose)
	} else {
		uploadChunkedFile(file, filePath, fileSize, chunkSize, uploadType, verbose)
	}
}

func uploadSingleFile(file *os.File, filePath string, fileSize int64, uploadType string, verbose bool) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	// Use "image" for image uploads, "file" for regular files
	fieldName := "file"
	if uploadType == "image" {
		fieldName = "image"

		// Check MAX_IMAGE_SIZE for image uploads
		maxImageSize := int64(viper.GetInt("image.MAX_IMAGE_SIZE") * 1024 * 1024)
		if fileSize > maxImageSize {
			fmt.Printf("Error: Image size (%d bytes) exceeds the maximum allowed size (%d bytes)\n", fileSize, maxImageSize)
			return
		}
	}

	part, err := writer.CreateFormFile(fieldName, filepath.Base(filePath))
	if err != nil {
		fmt.Printf("Error creating form file: %s\n", err)
		return
	}

	_, err = io.Copy(part, file)
	if err != nil {
		fmt.Printf("Error copying file to form: %s\n", err)
		return
	}

	err = writer.Close()
	if err != nil {
		fmt.Printf("Error closing multipart writer: %s\n", err)
		return
	}

	url := viper.GetString("general.baseUrl")
	if uploadType == "image" {
		url += "pic"
	} else {
		url += "upload"
	}

	req, err := http.NewRequest("POST", url, body)
	if err != nil {
		fmt.Printf("Error creating request: %s\n", err)
		return
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+viper.GetString("general.token"))

	if verbose {
		fmt.Printf("Request URL: %s\n", url)
		fmt.Printf("Authorization Header: %s\n", req.Header.Get("Authorization"))
		dumpRequest(req)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Error sending request: %s\n", err)
		return
	}
	defer resp.Body.Close()

	if verbose {
		dumpResponse(resp)
	}

	var result UploadResponse
	err = json.NewDecoder(resp.Body).Decode(&result)
	if err != nil {
		fmt.Printf("Error decoding response: %s\n", err)
		return
	}

	if result.Code == 1 {
		fmt.Printf("File uploaded successfully. URL: %s\n", result.URL)
	} else {
		fmt.Printf("Error uploading file: %s\n", result.Message)
	}
}

func uploadChunkedFile(file *os.File, filePath string, fileSize, chunkSize int64, uploadType string, verbose bool) {
	totalChunks := (fileSize + chunkSize - 1) / chunkSize

	// Initialize upload
	fileID, sessionID, err := initUpload(filePath, fileSize, totalChunks, chunkSize, verbose)
	if err != nil {
		fmt.Printf("Error initializing upload: %s\n", err)
		return
	}

	// Upload chunks
	for i := int64(0); i < totalChunks; i++ {
		startByte := i * chunkSize
		endByte := min(startByte+chunkSize, fileSize)
		chunkSize := endByte - startByte

		err := uploadChunk(file, filePath, fileID, sessionID, i, totalChunks, startByte, chunkSize, verbose)
		if err != nil {
			fmt.Printf("Error uploading chunk %d: %s\n", i+1, err)
			return
		}

		fmt.Printf("Uploaded chunk %d of %d\n", i+1, totalChunks)
	}

	fmt.Printf("All chunks uploaded successfully. File ID: %s\n", fileID)
}

func initUpload(filePath string, fileSize, totalChunks, chunkSize int64, verbose bool) (string, string, error) {
	url := viper.GetString("general.baseUrl") + "upload"

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	fileName := filepath.Base(filePath)
	mimeType := detectMimeType(filePath)

	writer.WriteField("isInit", "true")
	writer.WriteField("fileName", fileName)
	writer.WriteField("fileSize", strconv.FormatInt(fileSize, 10))
	writer.WriteField("totalChunks", strconv.FormatInt(totalChunks, 10))
	writer.WriteField("chunkSize", strconv.FormatInt(chunkSize, 10))
	writer.WriteField("fileType", mimeType) // Add this line

	err := writer.Close()
	if err != nil {
		return "", "", err
	}

	req, err := http.NewRequest("POST", url, body)
	if err != nil {
		return "", "", err
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+viper.GetString("general.token"))

	if verbose {
		fmt.Printf("Init Upload Request URL: %s\n", url)
		fmt.Printf("Init Upload Authorization Header: %s\n", req.Header.Get("Authorization"))
		dumpRequest(req)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	if verbose {
		dumpResponse(resp)
	}

	var result UploadResponse
	err = json.NewDecoder(resp.Body).Decode(&result)
	if err != nil {
		return "", "", err
	}

	if result.Code != 1 {
		return "", "", fmt.Errorf("failed to initialize upload: %s", result.Message)
	}

	return result.FileID, result.SessionID, nil
}

func uploadChunk(file *os.File, filePath, fileID, sessionID string, chunkIndex, totalChunks, startByte, chunkSize int64, verbose bool) error {
	url := viper.GetString("general.baseUrl") + "upload"

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	writer.WriteField("isChunk", "true")
	writer.WriteField("chunkIndex", strconv.FormatInt(chunkIndex, 10))
	writer.WriteField("totalChunks", strconv.FormatInt(totalChunks, 10))
	writer.WriteField("sessionId", sessionID)
	writer.WriteField("fileId", fileID)

	part, err := writer.CreateFormFile("file", fmt.Sprintf("%s.part%d", filepath.Base(filePath), chunkIndex))
	if err != nil {
		return err
	}

	_, err = file.Seek(startByte, 0)
	if err != nil {
		return err
	}

	_, err = io.CopyN(part, file, chunkSize)
	if err != nil {
		return err
	}

	err = writer.Close()
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", url, body)
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+viper.GetString("general.token"))

	if verbose {
		fmt.Printf("Chunk Upload Request URL: %s\n", url)
		fmt.Printf("Chunk Upload Authorization Header: %s\n", req.Header.Get("Authorization"))
		dumpRequest(req)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if verbose {
		dumpResponse(resp)
	}

	var result UploadResponse
	err = json.NewDecoder(resp.Body).Decode(&result)
	if err != nil {
		return err
	}

	if result.Code != 1 {
		return fmt.Errorf("failed to upload chunk: %s", result.Message)
	}

	return nil
}

func min(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func dumpRequest(req *http.Request) {
	fmt.Println("Request Headers:")
	for name, values := range req.Header {
		for _, value := range values {
			fmt.Printf("%s: %s\n", name, value)
		}
	}
	fmt.Println("Request URL:", req.URL.String())
	fmt.Println("Request Method:", req.Method)
}

func dumpResponse(resp *http.Response) {
	dump, err := httputil.DumpResponse(resp, true)
	if err != nil {
		fmt.Printf("Error dumping response: %s\n", err)
	} else {
		fmt.Printf("Response dump:\n%s\n", dump)
	}
}

func detectMimeType(filePath string) string {
	file, err := os.Open(filePath)
	if err != nil {
		fmt.Printf("Error opening file: %s\n", err)
		return "application/octet-stream"
	}
	defer file.Close()

	// Read the first 12 bytes to check for WebP signature
	header := make([]byte, 12)
	if _, err := io.ReadFull(file, header); err != nil {
		fmt.Printf("Error reading file header: %s\n", err)
		return "application/octet-stream"
	}

	// Check for WebP signature
	if isWebP(header) {
		return "image/webp"
	}

	// Reset file pointer
	file.Seek(0, 0)

	// If not WebP, use mimetype library
	mime, err := mimetype.DetectReader(file)
	if err != nil {
		fmt.Printf("Error detecting MIME type: %s\n", err)
		return "application/octet-stream"
	}
	return mime.String()
}

func isWebP(header []byte) bool {
	if len(header) < 12 {
		return false
	}
	return string(header[:4]) == "RIFF" && string(header[8:12]) == "WEBP"
}

func uploadImageFromClipboard(verbose bool) {
	fmt.Println("Attempting to read clipboard content...")

	// Initialize the clipboard
	err := clipboard.Init()
	if err != nil {
		fmt.Printf("Error initializing clipboard: %s\n", err)
		return
	}

	// Try reading different formats
	formats := []clipboard.Format{clipboard.FmtImage, clipboard.FmtText}
	for _, format := range formats {
		data := clipboard.Read(format)
		fmt.Printf("Raw clipboard data length for %v: %d\n", format, len(data))
		if len(data) > 0 {
			fmt.Printf("Found data in clipboard for format %v\n", format)
			if format == clipboard.FmtImage {
				// Process image data
				processImageData(data, verbose)
			} else {
				// Just print the first 100 characters for text
				fmt.Printf("First 100 characters: %s\n", string(data[:min(int64(100), int64(len(data)))]))
			}
			return
		}
	}

	fmt.Println("Clipboard is empty for all checked formats")
}

func processImageData(imageData []byte, verbose bool) {
	// Use mimetype to detect the MIME type
	mtype, err := mimetype.DetectReader(bytes.NewReader(imageData))
	if err != nil {
		fmt.Printf("Error detecting MIME type: %s\n", err)
		return
	}

	mimeType := mtype.String()
	fmt.Printf("Detected MIME type: %s\n", mimeType)
	fmt.Printf("MIME type details: %+v\n", mtype)

	if !strings.HasPrefix(mimeType, "image/") {
		fmt.Println("Clipboard content is not a recognized image format")
		return
	}

	// Now we have the image data and mime type, we can proceed with the upload
	uploadImageData(imageData, mimeType, verbose)
}

func uploadImageData(imageData []byte, mimeType string, verbose bool) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("image", "clipboard_image")
	if err != nil {
		fmt.Printf("Error creating form file: %s\n", err)
		return
	}

	_, err = io.Copy(part, bytes.NewReader(imageData))
	if err != nil {
		fmt.Printf("Error copying image data to form: %s\n", err)
		return
	}

	err = writer.Close()
	if err != nil {
		fmt.Printf("Error closing multipart writer: %s\n", err)
		return
	}

	url := viper.GetString("general.baseUrl") + "pic"

	req, err := http.NewRequest("POST", url, body)
	if err != nil {
		fmt.Printf("Error creating request: %s\n", err)
		return
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+viper.GetString("general.token"))

	if verbose {
		fmt.Printf("Request URL: %s\n", url)
		fmt.Printf("Authorization Header: %s\n", req.Header.Get("Authorization"))
		dumpRequest(req)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Error sending request: %s\n", err)
		return
	}
	defer resp.Body.Close()

	if verbose {
		dumpResponse(resp)
	}

	var result UploadResponse
	err = json.NewDecoder(resp.Body).Decode(&result)
	if err != nil {
		fmt.Printf("Error decoding response: %s\n", err)
		return
	}

	if result.Code == 1 {
		fmt.Printf("Image uploaded successfully. URL: %s\n", result.URL)
	} else {
		fmt.Printf("Error uploading image: %s\n", result.Message)
	}
}
