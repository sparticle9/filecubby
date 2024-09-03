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

/**
 * Uploads a file to the server.
 * @param filePath - The path to the file to upload.
 * @param uploadType - The type of upload (e.g., "image").
 * @param verbose - Whether to enable verbose logging.
 */
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

	mtype, err := mimetype.DetectFile(filePath)
	if err != nil {
		fmt.Printf("Error detecting MIME type: %s\n", err)
		return
	}
	detectedMimeType := mtype.String()
	fmt.Printf("Detected MIME type: %s\n", detectedMimeType)

	// Check if it's an image upload and validate MIME type
	if uploadType == "image" {
		if !strings.HasPrefix(detectedMimeType, "image/") {
			fmt.Printf("Error: File is not a recognized image format. Detected MIME type: %s\n", detectedMimeType)
			return
		}

		// Check MAX_IMAGE_SIZE for image uploads
		maxImageSize := int64(viper.GetInt("image.MAX_IMAGE_SIZE") * 1024 * 1024)
		if fileSize > maxImageSize {
			fmt.Printf("Error: Image size (%d bytes) exceeds the maximum allowed size (%d bytes)\n", fileSize, maxImageSize)
			return
		}
	}

	if fileSize <= chunkSize {
		uploadSingleFile(file, filePath, fileSize, uploadType, verbose, detectedMimeType)
	} else {
		uploadChunkedFile(file, filePath, fileSize, chunkSize, uploadType, verbose, detectedMimeType)
	}
}

/**
 * Uploads a single file to the server.
 * @param file - The file to upload.
 * @param filePath - The path to the file.
 * @param fileSize - The size of the file.
 * @param uploadType - The type of upload (e.g., "image").
 * @param verbose - Whether to enable verbose logging.
 * @param mimeType - The MIME type of the file.
 */
func uploadSingleFile(file *os.File, filePath string, fileSize int64, uploadType string, verbose bool, mimeType string) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	// Use "image" for image uploads, "file" for regular files
	fieldName := "file"
	if uploadType == "image" {
		fieldName = "image"
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

	// Write the fileType field before closing the writer
	err = writer.WriteField("fileType", mimeType)
	if err != nil {
		fmt.Printf("Error writing fileType field: %s\n", err)
		return
	}

	// Write the fileName field before closing the writer
	err = writer.WriteField("fileName", filepath.Base(filePath))
	if err != nil {
		fmt.Printf("Error writing fileName field: %s\n", err)
		return
	}

	// Make sure this is done before closing the writer
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

/**
 * Uploads a file in chunks to the server.
 * @param file - The file to upload.
 * @param filePath - The path to the file.
 * @param fileSize - The size of the file.
 * @param chunkSize - The size of each chunk.
 * @param uploadType - The type of upload (e.g., "image").
 * @param verbose - Whether to enable verbose logging.
 * @param mimeType - The MIME type of the file.
 */
func uploadChunkedFile(file *os.File, filePath string, fileSize, chunkSize int64, uploadType string, verbose bool, mimeType string) {
	totalChunks := (fileSize + chunkSize - 1) / chunkSize

	// Initialize upload
	fileID, err := initUpload(filePath, fileSize, totalChunks, chunkSize, verbose, mimeType)
	if err != nil {
		fmt.Printf("Error initializing upload: %s\n", err)
		return
	}

	// Debug prints to ensure fileID is initialized
	fmt.Printf("Initialized upload with fileID: %s\n", fileID)

	var finalResult UploadResponse

	// Upload chunks
	for i := int64(0); i < totalChunks; i++ {
		startByte := i * chunkSize
		endByte := min(startByte+chunkSize, fileSize)
		chunkSize := endByte - startByte

		result, err := uploadChunk(file, filePath, fileID, i, totalChunks, startByte, chunkSize, verbose)
		if err != nil {
			fmt.Printf("Error uploading chunk %d: %s\n", i+1, err)
			return
		}

		fmt.Printf("Uploaded chunk %d of %d\n", i+1, totalChunks)

		// Store the result of the last chunk
		if i == totalChunks-1 {
			finalResult = result
		}
	}

	fmt.Printf("All chunks uploaded successfully. File ID: %s\n", fileID)
	fmt.Printf("Message: %s\n", finalResult.Message)
	fmt.Printf("URL: %s\n", finalResult.URL)
}

/**
 * Initializes the upload process.
 * @param filePath - The path to the file.
 * @param fileSize - The size of the file.
 * @param totalChunks - The total number of chunks.
 * @param chunkSize - The size of each chunk.
 * @param verbose - Whether to enable verbose logging.
 * @param mimeType - The MIME type of the file.
 * @returns The file ID and an error, if any.
 */
func initUpload(filePath string, fileSize, totalChunks, chunkSize int64, verbose bool, mimeType string) (string, error) {
	url := viper.GetString("general.baseUrl") + "upload"

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	fileName := filepath.Base(filePath)

	writer.WriteField("isInit", "true")
	writer.WriteField("fileName", fileName)
	writer.WriteField("fileSize", strconv.FormatInt(fileSize, 10))
	writer.WriteField("totalChunks", strconv.FormatInt(totalChunks, 10))
	writer.WriteField("chunkSize", strconv.FormatInt(chunkSize, 10))
	writer.WriteField("fileType", mimeType)

	err := writer.Close()
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest("POST", url, body)
	if err != nil {
		return "", err
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+viper.GetString("general.token"))

	if verbose {
		fmt.Printf("Init Upload Request URL: %s\n", url)
		fmt.Println() // Add a newline after the body dump
		dumpRequest(req)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if verbose {
		dumpResponse(resp)
	}

	var result UploadResponse
	err = json.NewDecoder(resp.Body).Decode(&result)
	if err != nil {
		return "", err
	}

	if result.Code != 1 {
		return "", fmt.Errorf("failed to initialize upload: %s", result.Message)
	}

	return result.FileID, nil
}

/**
 * Uploads a chunk of a file to the server.
 * @param file - The file to upload.
 * @param filePath - The path to the file.
 * @param fileID - The ID of the file.
 * @param chunkIndex - The index of the chunk.
 * @param totalChunks - The total number of chunks.
 * @param startByte - The starting byte of the chunk.
 * @param chunkSize - The size of the chunk.
 * @param verbose - Whether to enable verbose logging.
 * @returns The upload response and an error, if any.
 */
func uploadChunk(file *os.File, filePath, fileID string, chunkIndex, totalChunks, startByte, chunkSize int64, verbose bool) (UploadResponse, error) {
	url := viper.GetString("general.baseUrl") + "upload"

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	writer.WriteField("isChunk", "true")
	writer.WriteField("chunkIndex", strconv.FormatInt(chunkIndex, 10))
	writer.WriteField("totalChunks", strconv.FormatInt(totalChunks, 10))
	writer.WriteField("fileId", fileID)
	writer.WriteField("fileName", filepath.Base(filePath)) // Add fileName field

	part, err := writer.CreateFormFile("file", fmt.Sprintf("%s.part%d", filepath.Base(filePath), chunkIndex))
	if err != nil {
		return UploadResponse{}, err
	}

	_, err = file.Seek(startByte, 0)
	if err != nil {
		return UploadResponse{}, err
	}

	_, err = io.CopyN(part, file, chunkSize)
	if err != nil {
		return UploadResponse{}, err
	}

	err = writer.Close()
	if err != nil {
		return UploadResponse{}, err
	}

	req, err := http.NewRequest("POST", url, body)
	if err != nil {
		return UploadResponse{}, err
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+viper.GetString("general.token"))

	if verbose {
		fmt.Printf("Chunk Upload Request URL: %s\n", url)
		fmt.Println() // Add a newline after the body dump
		dumpRequest(req)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return UploadResponse{}, err
	}
	defer resp.Body.Close()

	if verbose {
		dumpResponse(resp)
	}

	var result UploadResponse
	err = json.NewDecoder(resp.Body).Decode(&result)
	if err != nil {
		return UploadResponse{}, err
	}

	if result.Code != 1 {
		return UploadResponse{}, fmt.Errorf("failed to upload chunk: %s", result.Message)
	}

	return result, nil
}

/**
 * Returns the minimum of two int64 values.
 * @param a - The first value.
 * @param b - The second value.
 * @returns The minimum value.
 */
func min(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

/**
 * Dumps the request headers and URL.
 * @param req - The HTTP request.
 */
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

/**
 * Dumps the response.
 * @param resp - The HTTP response.
 */
func dumpResponse(resp *http.Response) {
	dump, err := httputil.DumpResponse(resp, true)
	if err != nil {
		fmt.Printf("Error dumping response: %s\n", err)
	} else {
		fmt.Printf("Response dump:\n%s\n", dump)
	}
}

/**
 * Processes image data from the clipboard.
 * @param imageData - The image data.
 * @param verbose - Whether to enable verbose logging.
 */
func processImageData(imageData []byte, verbose bool) {
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

/**
 * Uploads image data to the server.
 * @param imageData - The image data.
 * @param mimeType - The MIME type of the image.

</rewritten_file>
