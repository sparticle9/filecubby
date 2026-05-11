package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/spf13/cobra"
)

type CollectionRecord struct {
	NamespaceID string   `json:"namespaceId"`
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Slug        string   `json:"slug"`
	Description string   `json:"description,omitempty"`
	Path        string   `json:"path,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	CreatedAt   string   `json:"createdAt"`
	UpdatedAt   string   `json:"updatedAt"`
}

type ListCollectionsResponse struct {
	Code        int                `json:"Code"`
	Message     string             `json:"Message,omitempty"`
	Collections []CollectionRecord `json:"collections"`
	Count       int                `json:"count"`
}

type CollectionResponse struct {
	Code       int              `json:"Code"`
	Message    string           `json:"Message,omitempty"`
	Collection CollectionRecord `json:"collection"`
}

func newCollectionsCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "collections",
		Short: "Manage object collections",
	}

	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List collections",
		RunE: func(cmd *cobra.Command, args []string) error {
			var result ListCollectionsResponse
			if err := doJSON(http.MethodGet, "collections", nil, &result); err != nil {
				return err
			}
			if jsonOutput {
				return printJSON(result)
			}
			for _, item := range result.Collections {
				fmt.Printf("%s\t%s\t%s\t%s\n", item.ID, item.Slug, item.Path, item.Name)
			}
			return nil
		},
	}

	var slug string
	var path string
	var tags []string
	var description string
	createCmd := &cobra.Command{
		Use:   "create <name>",
		Short: "Create a collection",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			body := map[string]any{"name": args[0]}
			if slug != "" {
				body["slug"] = slug
			}
			if path != "" {
				body["path"] = path
			}
			if len(tags) > 0 {
				body["tags"] = tags
			}
			if description != "" {
				body["description"] = description
			}
			var result CollectionResponse
			if err := doJSON(http.MethodPost, "collections", body, &result); err != nil {
				return err
			}
			if jsonOutput {
				return printJSON(result)
			}
			fmt.Printf("Created collection %s (%s)\n", result.Collection.ID, result.Collection.Name)
			return nil
		},
	}
	createCmd.Flags().StringVar(&slug, "slug", "", "stable slug")
	createCmd.Flags().StringVar(&path, "path", "", "default logical path")
	createCmd.Flags().StringSliceVar(&tags, "tag", nil, "default tag; repeat or comma-separate")
	createCmd.Flags().StringVar(&description, "description", "", "description")

	updateCmd := &cobra.Command{
		Use:   "update <id>",
		Short: "Update a collection",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			body := map[string]any{}
			if cmd.Flags().Changed("slug") {
				body["slug"] = slug
			}
			if cmd.Flags().Changed("path") {
				body["path"] = path
			}
			if cmd.Flags().Changed("tag") {
				body["tags"] = tags
			}
			if cmd.Flags().Changed("description") {
				body["description"] = description
			}
			name, _ := cmd.Flags().GetString("name")
			if strings.TrimSpace(name) != "" {
				body["name"] = name
			}
			if len(body) == 0 {
				return fmt.Errorf("nothing to update")
			}
			var result CollectionResponse
			if err := doJSON(http.MethodPatch, "collections/"+args[0], body, &result); err != nil {
				return err
			}
			if jsonOutput {
				return printJSON(result)
			}
			pretty, _ := json.MarshalIndent(result.Collection, "", "  ")
			fmt.Println(string(pretty))
			return nil
		},
	}
	updateCmd.Flags().String("name", "", "new name")
	updateCmd.Flags().StringVar(&slug, "slug", "", "new slug")
	updateCmd.Flags().StringVar(&path, "path", "", "new default path")
	updateCmd.Flags().StringSliceVar(&tags, "tag", nil, "replace tags")
	updateCmd.Flags().StringVar(&description, "description", "", "new description")

	deleteCmd := &cobra.Command{
		Use:   "delete <id>",
		Short: "Delete a collection",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var result apiResponse
			if err := doJSON(http.MethodDelete, "collections/"+args[0], nil, &result); err != nil {
				return err
			}
			if jsonOutput {
				return printJSON(result)
			}
			fmt.Println(result.Message)
			return nil
		},
	}

	cmd.AddCommand(listCmd, createCmd, updateCmd, deleteCmd)
	return cmd
}
