package main

import (
	"fmt"
	"net/http"

	"github.com/spf13/cobra"
)

type ServiceToken struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Enabled    bool   `json:"enabled"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
	Note       string `json:"note,omitempty"`
	LastUsedAt string `json:"lastUsedAt,omitempty"`
}

type ListTokensResponse struct {
	Code    int            `json:"Code"`
	Message string         `json:"Message,omitempty"`
	Tokens  []ServiceToken `json:"tokens"`
}

type TokenResponse struct {
	Code         int          `json:"Code"`
	Message      string       `json:"Message,omitempty"`
	Token        string       `json:"token,omitempty"`
	ServiceToken ServiceToken `json:"serviceToken,omitempty"`
}

func newTokensCommand() *cobra.Command {
	tokensCmd := &cobra.Command{
		Use:   "tokens",
		Short: "Manage named service tokens",
	}

	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List service tokens",
		RunE: func(cmd *cobra.Command, args []string) error {
			var result ListTokensResponse
			if err := doJSON(http.MethodGet, "tokens", nil, &result); err != nil {
				return err
			}
			if jsonOutput {
				return printJSON(result)
			}
			for _, token := range result.Tokens {
				status := "disabled"
				if token.Enabled {
					status = "enabled"
				}
				note := ""
				if token.Note != "" {
					note = " - " + token.Note
				}
				fmt.Printf("%s\t%s\t%s%s\n", token.ID, status, token.Name, note)
			}
			return nil
		},
	}

	var createNote string
	createCmd := &cobra.Command{
		Use:   "create <name>",
		Short: "Create a service token",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			body := map[string]string{"name": args[0]}
			if createNote != "" {
				body["note"] = createNote
			}
			var result TokenResponse
			if err := doJSON(http.MethodPost, "tokens", body, &result); err != nil {
				return err
			}
			if jsonOutput {
				return printJSON(result)
			}
			fmt.Printf("Created token %s (%s)\n", result.ServiceToken.ID, result.ServiceToken.Name)
			fmt.Printf("Token: %s\n", result.Token)
			return nil
		},
	}
	createCmd.Flags().StringVar(&createNote, "note", "", "optional note")

	var updateName string
	var updateNote string
	var clearNote bool
	updateCmd := &cobra.Command{
		Use:   "update <id>",
		Short: "Update token metadata",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			body := map[string]any{}
			if updateName != "" {
				body["name"] = updateName
			}
			if updateNote != "" {
				body["note"] = updateNote
			}
			if clearNote {
				body["note"] = nil
			}
			if len(body) == 0 {
				return fmt.Errorf("nothing to update")
			}
			return patchToken(args[0], body)
		},
	}
	updateCmd.Flags().StringVar(&updateName, "name", "", "new display name")
	updateCmd.Flags().StringVar(&updateNote, "note", "", "new note")
	updateCmd.Flags().BoolVar(&clearNote, "clear-note", false, "clear token note")

	enableCmd := &cobra.Command{
		Use:   "enable <id>",
		Short: "Enable a service token",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return patchToken(args[0], map[string]any{"enabled": true})
		},
	}

	disableCmd := &cobra.Command{
		Use:   "disable <id>",
		Short: "Disable a service token",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return patchToken(args[0], map[string]any{"enabled": false})
		},
	}

	deleteCmd := &cobra.Command{
		Use:   "delete <id>",
		Short: "Delete a service token",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var result apiResponse
			if err := doJSON(http.MethodDelete, "tokens/"+args[0], nil, &result); err != nil {
				return err
			}
			if jsonOutput {
				return printJSON(result)
			}
			fmt.Println(result.Message)
			return nil
		},
	}

	tokensCmd.AddCommand(listCmd, createCmd, updateCmd, enableCmd, disableCmd, deleteCmd)
	return tokensCmd
}

func patchToken(id string, body map[string]any) error {
	var result TokenResponse
	if err := doJSON(http.MethodPatch, "tokens/"+id, body, &result); err != nil {
		return err
	}
	if jsonOutput {
		return printJSON(result)
	}
	fmt.Printf("Updated token %s (%s): enabled=%t\n", result.ServiceToken.ID, result.ServiceToken.Name, result.ServiceToken.Enabled)
	return nil
}
