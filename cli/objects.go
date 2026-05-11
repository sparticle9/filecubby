package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
)

type ObjectRecord struct {
	NamespaceID   string   `json:"namespaceId"`
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Size          int64    `json:"size"`
	Type          string   `json:"type"`
	Path          string   `json:"path"`
	Tags          []string `json:"tags"`
	CollectionIDs []string `json:"collectionIds"`
	Description   string   `json:"description,omitempty"`
	URL           string   `json:"url"`
	UploadedAt    string   `json:"uploadedAt"`
	UpdatedAt     string   `json:"updatedAt"`
}

type ListObjectsResponse struct {
	Code    int            `json:"Code"`
	Message string         `json:"Message,omitempty"`
	Objects []ObjectRecord `json:"objects"`
	Count   int            `json:"count"`
}

type ObjectResponse struct {
	Code    int          `json:"Code"`
	Message string       `json:"Message,omitempty"`
	Object  ObjectRecord `json:"object"`
}

func newObjectsCommand() *cobra.Command {
	var pathFilter string
	var tagFilter string
	var collectionFilter string
	var query string
	var limit int

	listCmd := &cobra.Command{
		Use:     "ls",
		Aliases: []string{"list"},
		Short:   "List objects",
		RunE: func(cmd *cobra.Command, args []string) error {
			endpoint := "objects"
			params := []string{}
			if pathFilter != "" {
				params = append(params, "path="+escapeQuery(pathFilter))
			}
			if tagFilter != "" {
				params = append(params, "tag="+escapeQuery(tagFilter))
			}
			if collectionFilter != "" {
				params = append(params, "collectionId="+escapeQuery(collectionFilter))
			}
			if query != "" {
				params = append(params, "q="+escapeQuery(query))
			}
			if limit > 0 {
				params = append(params, fmt.Sprintf("limit=%d", limit))
			}
			if len(params) > 0 {
				endpoint += "?" + strings.Join(params, "&")
			}

			var result ListObjectsResponse
			if err := doJSON(http.MethodGet, endpoint, nil, &result); err != nil {
				return err
			}
			if jsonOutput {
				return printJSON(result)
			}
			for _, object := range result.Objects {
				fmt.Printf("%s\t%d\t%s\t%s\t%s\n", object.ID, object.Size, object.Path, strings.Join(object.Tags, ","), object.Name)
			}
			return nil
		},
	}
	listCmd.Flags().StringVar(&pathFilter, "path", "", "filter by logical path")
	listCmd.Flags().StringVar(&tagFilter, "tag", "", "filter by tag")
	listCmd.Flags().StringVar(&collectionFilter, "collection", "", "filter by collection id")
	listCmd.Flags().StringVarP(&query, "query", "q", "", "search object names and descriptions")
	listCmd.Flags().IntVar(&limit, "limit", 50, "maximum records to return")

	metaCmd := &cobra.Command{
		Use:     "meta <object-id>",
		Aliases: []string{"info"},
		Short:   "Show object metadata",
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var result ObjectResponse
			if err := doJSON(http.MethodGet, "objects/"+args[0], nil, &result); err != nil {
				return err
			}
			if jsonOutput {
				return printJSON(result)
			}
			pretty, _ := json.MarshalIndent(result.Object, "", "  ")
			fmt.Println(string(pretty))
			return nil
		},
	}

	getCmd := &cobra.Command{
		Use:   "get <object-id> [output]",
		Short: "Download an object",
		Args:  cobra.RangeArgs(1, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			output := ""
			if len(args) == 2 {
				output = args[1]
			}
			return downloadFile(args[0], output)
		},
	}

	mvCmd := &cobra.Command{
		Use:   "mv <object-id> <path>",
		Short: "Move an object to a logical path",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			return patchObjectMetadata(args[0], map[string]any{"path": args[1]})
		},
	}

	tagCmd := &cobra.Command{
		Use:   "tag <object-id> <tag>[,<tag>...]",
		Short: "Replace object tags",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			return patchObjectMetadata(args[0], map[string]any{"tags": splitCSV(args[1])})
		},
	}

	objectsCmd := &cobra.Command{
		Use:   "objects",
		Short: "List and update object metadata",
	}
	objectsCmd.AddCommand(listCmd, metaCmd, getCmd, mvCmd, tagCmd)
	return objectsCmd
}

func topLevelObjectCommands() []*cobra.Command {
	objects := newObjectsCommand()
	return objects.Commands()
}

func patchObjectMetadata(id string, body map[string]any) error {
	var result ObjectResponse
	if err := doJSON(http.MethodPatch, "objects/"+id, body, &result); err != nil {
		return err
	}
	if jsonOutput {
		return printJSON(result)
	}
	fmt.Printf("Updated %s\n", result.Object.ID)
	return nil
}

func downloadFile(id string, output string) error {
	apiBase, err := apiBaseURL()
	if err != nil {
		return err
	}
	downloadBase := strings.TrimSuffix(apiBase, "/api/")
	url := downloadBase + "/d/" + id
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("download failed: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if output == "" {
		output = filenameFromDisposition(resp.Header.Get("Content-Disposition"))
		if output == "" {
			output = id
		}
	}
	out, err := os.Create(output)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, resp.Body); err != nil {
		return err
	}
	if jsonOutput {
		return printJSON(map[string]any{"Code": 1, "objectId": id, "output": output})
	}
	fmt.Printf("Downloaded %s\n", output)
	return nil
}

func filenameFromDisposition(value string) string {
	for _, part := range strings.Split(value, ";") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(strings.ToLower(part), "filename=") {
			name := strings.Trim(strings.TrimPrefix(part, "filename="), `"`)
			if name != "" {
				return filepath.Base(name)
			}
		}
	}
	return ""
}

func escapeQuery(value string) string {
	replacer := strings.NewReplacer(" ", "%20", "/", "%2F", ",", "%2C", "#", "%23", "?", "%3F", "&", "%26", "=", "%3D")
	return replacer.Replace(value)
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}
