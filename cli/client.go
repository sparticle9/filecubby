package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/spf13/viper"
)

type apiResponse struct {
	Code    int    `json:"Code"`
	Message string `json:"Message"`
}

func apiBaseURL() (string, error) {
	base := strings.TrimSpace(viper.GetString("general.baseUrl"))
	if envBase := strings.TrimSpace(os.Getenv("FILECUBBY_BASE_URL")); envBase != "" {
		base = envBase
	} else if envBase := strings.TrimSpace(os.Getenv("FILECUBBY_API_BASE_URL")); envBase != "" {
		base = envBase
	} else if envBase := strings.TrimSpace(os.Getenv("FILECUBBY_URL")); envBase != "" && base == "http://localhost:8787/api/" {
		base = envBase
	}
	if base == "" {
		return "", fmt.Errorf("missing API base URL")
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid API base URL: %s", base)
	}
	base = strings.TrimRight(base, "/")
	if !strings.HasSuffix(base, "/api") {
		base += "/api"
	}
	base += "/"
	return base, nil
}

func apiToken() (string, error) {
	token := strings.TrimSpace(viper.GetString("general.token"))
	if envToken := strings.TrimSpace(os.Getenv("FILECUBBY_TOKEN")); envToken != "" {
		token = envToken
	}
	if token == "" {
		return "", fmt.Errorf("missing token; set general.token, FILECUBBY_TOKEN, or --token")
	}
	return token, nil
}

func newAPIRequest(method, endpoint string, body io.Reader, contentType string) (*http.Request, error) {
	base, err := apiBaseURL()
	if err != nil {
		return nil, err
	}
	token, err := apiToken()
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(method, base+strings.TrimPrefix(endpoint, "/"), body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if verbose {
		dumpRequest(req)
	}
	return req, nil
}

func doJSON(method, endpoint string, requestBody any, out any) error {
	var reader io.Reader
	if requestBody != nil {
		buf := &bytes.Buffer{}
		if err := json.NewEncoder(buf).Encode(requestBody); err != nil {
			return err
		}
		reader = buf
	}

	req, err := newAPIRequest(method, endpoint, reader, "application/json")
	if err != nil {
		return err
	}

	return doRequest(req, out)
}

func doMultipart(endpoint string, body *bytes.Buffer, writer *multipart.Writer, out any) error {
	req, err := newAPIRequest(http.MethodPost, endpoint, body, writer.FormDataContentType())
	if err != nil {
		return err
	}
	return doRequest(req, out)
}

func doRequest(req *http.Request, out any) error {
	client := &http.Client{Timeout: apiTimeout()}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if verbose {
		dumpResponse(resp, body)
	}

	if len(body) == 0 {
		if resp.StatusCode >= 400 {
			return fmt.Errorf("request failed: HTTP %d", resp.StatusCode)
		}
		return nil
	}

	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode response: %w: %s", err, string(body))
	}

	if resp.StatusCode >= 400 {
		return fmt.Errorf("request failed: HTTP %d: %s", resp.StatusCode, responseMessage(out))
	}
	if responseCode(out) == 0 {
		return fmt.Errorf("request failed: %s", responseMessage(out))
	}
	return nil
}

func responseCode(value any) int {
	encoded, err := json.Marshal(value)
	if err != nil {
		return 1
	}
	var response apiResponse
	if err := json.Unmarshal(encoded, &response); err != nil {
		return 1
	}
	if response.Code == 0 && response.Message == "" {
		return 1
	}
	return response.Code
}

func responseMessage(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	var response apiResponse
	if err := json.Unmarshal(encoded, &response); err != nil {
		return ""
	}
	return response.Message
}

func dumpRequest(req *http.Request) {
	fmt.Println("Request Headers:")
	for name, values := range req.Header {
		for _, value := range values {
			if strings.EqualFold(name, "Authorization") {
				value = "Bearer <redacted>"
			}
			fmt.Printf("%s: %s\n", name, value)
		}
	}
	fmt.Println("Request URL:", req.URL.String())
	fmt.Println("Request Method:", req.Method)
}

func dumpResponse(resp *http.Response, body []byte) {
	fmt.Printf("Response Status: %s\n", resp.Status)
	fmt.Println("Response Headers:")
	for name, values := range resp.Header {
		for _, value := range values {
			fmt.Printf("%s: %s\n", name, value)
		}
	}
	if len(body) > 0 {
		fmt.Printf("Response Body:\n%s\n", body)
	}
}
