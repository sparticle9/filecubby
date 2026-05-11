package main

import (
	"fmt"
	"net/http"

	"github.com/spf13/cobra"
)

type ImportTelegramResponse struct {
	Code       int      `json:"Code"`
	Message    string   `json:"Message,omitempty"`
	Scanned    int      `json:"scanned"`
	Imported   []string `json:"imported"`
	Skipped    []any    `json:"skipped"`
	NextOffset int64    `json:"nextOffset,omitempty"`
}

func newRepairCommand() *cobra.Command {
	var dryRun bool
	var overwrite bool
	var limit int
	var offset int64

	importCmd := &cobra.Command{
		Use:   "import-telegram",
		Short: "Import KV metadata from visible Telegram manifests and captions",
		RunE: func(cmd *cobra.Command, args []string) error {
			body := map[string]any{
				"dryRun":    dryRun,
				"overwrite": overwrite,
				"limit":     limit,
			}
			if cmd.Flags().Changed("offset") {
				body["offset"] = offset
			}
			var result ImportTelegramResponse
			if err := doJSON(http.MethodPost, "repair/import-telegram", body, &result); err != nil {
				return err
			}
			if jsonOutput {
				return printJSON(result)
			}
			fmt.Printf("%s: scanned=%d imported=%d skipped=%d", result.Message, result.Scanned, len(result.Imported), len(result.Skipped))
			if result.NextOffset != 0 {
				fmt.Printf(" nextOffset=%d", result.NextOffset)
			}
			fmt.Println()
			return nil
		},
	}
	importCmd.Flags().BoolVar(&dryRun, "dry-run", true, "scan without writing KV metadata")
	importCmd.Flags().BoolVar(&overwrite, "overwrite", false, "overwrite existing object metadata")
	importCmd.Flags().IntVar(&limit, "limit", 100, "Telegram getUpdates limit")
	importCmd.Flags().Int64Var(&offset, "offset", 0, "Telegram getUpdates offset")

	cmd := &cobra.Command{
		Use:   "repair",
		Short: "Repair metadata from Telegram recovery records",
	}
	cmd.AddCommand(importCmd)
	return cmd
}
