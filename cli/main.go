package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var cfgFile string
var verbose bool
var jsonOutput bool

func main() {
	rootCmd := &cobra.Command{
		Use:           "filecubby",
		Short:         "Upload objects to Filecubby and manage service tokens",
		SilenceUsage:  true,
		SilenceErrors: true,
	}

	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default is ~/.config/filecubby/config.yml)")
	rootCmd.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false, "verbose output")
	rootCmd.PersistentFlags().BoolVar(&jsonOutput, "json", false, "print machine-readable JSON")
	rootCmd.PersistentFlags().String("base-url", "", "Filecubby API base URL")
	rootCmd.PersistentFlags().String("token", "", "service or admin token")

	must(viper.BindPFlag("general.baseUrl", rootCmd.PersistentFlags().Lookup("base-url")))
	must(viper.BindPFlag("general.token", rootCmd.PersistentFlags().Lookup("token")))

	var uploadPath string
	var uploadTags []string
	var uploadCollections []string
	var uploadDescription string
	uploadOpts := func() UploadOptions {
		return UploadOptions{
			Path:          uploadPath,
			Tags:          uploadTags,
			CollectionIDs: uploadCollections,
			Description:   uploadDescription,
		}
	}

	ufCmd := &cobra.Command{
		Use:   "uf <filepath>",
		Short: "Upload an object",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			_, err := uploadFile(args[0], "drive", uploadOpts())
			return err
		},
	}
	ufCmd.Flags().StringVar(&uploadPath, "path", "", "logical path, for example /audio/drafts")
	ufCmd.Flags().StringSliceVar(&uploadTags, "tag", nil, "tag to attach; repeat or comma-separate")
	ufCmd.Flags().StringSliceVar(&uploadCollections, "collection", nil, "collection id to attach; repeat or comma-separate")
	ufCmd.Flags().StringVar(&uploadDescription, "description", "", "short object description")

	uiCmd := &cobra.Command{
		Use:   "ui [filepath]",
		Short: "Upload an image from the clipboard or a file",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return uploadImageFromClipboard(uploadOpts())
			}
			_, err := uploadFile(args[0], "image", uploadOpts())
			return err
		},
	}
	uiCmd.Flags().StringVar(&uploadPath, "path", "", "logical path, for example /images")
	uiCmd.Flags().StringSliceVar(&uploadTags, "tag", nil, "tag to attach; repeat or comma-separate")
	uiCmd.Flags().StringSliceVar(&uploadCollections, "collection", nil, "collection id to attach; repeat or comma-separate")
	uiCmd.Flags().StringVar(&uploadDescription, "description", "", "short image description")

	rootCmd.AddCommand(ufCmd, uiCmd, newObjectsCommand(), newCollectionsCommand(), newRepairCommand(), newTokensCommand())
	rootCmd.AddCommand(topLevelObjectCommands()...)

	cobra.OnInitialize(initConfig)

	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func initConfig() {
	viper.SetDefault("general.baseUrl", "http://localhost:8787/api/")
	viper.SetDefault("general.timeout", 30)
	viper.SetDefault("general.MAX_CHUNK_SIZE", 19)
	viper.SetDefault("image.MAX_IMAGE_SIZE", 10)
	viper.SetEnvPrefix("FILECUBBY")
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	viper.AutomaticEnv()
	must(viper.BindEnv("general.baseUrl", "FILECUBBY_BASE_URL", "FILECUBBY_API_BASE_URL"))
	must(viper.BindEnv("general.token", "FILECUBBY_TOKEN"))

	if cfgFile != "" {
		viper.SetConfigFile(cfgFile)
	} else {
		if configFile, ok := defaultConfigFile(); ok {
			viper.SetConfigFile(configFile)
		}
	}

	if err := viper.ReadInConfig(); err == nil {
		if verbose {
			fmt.Println("Using config file:", viper.ConfigFileUsed())
		}
	} else if cfgFile != "" {
		fmt.Fprintf(os.Stderr, "Error reading config file: %s\n", err)
		os.Exit(1)
	}
}

func defaultConfigFile() (string, bool) {
	if configHome := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); configHome != "" {
		return filepath.Join(configHome, "filecubby", "config.yml"), true
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return "", false
	}
	return filepath.Join(home, ".config", "filecubby", "config.yml"), true
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

func printJSON(value any) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func apiTimeout() time.Duration {
	seconds := viper.GetInt("general.timeout")
	if seconds <= 0 {
		seconds = 30
	}
	return time.Duration(seconds) * time.Second
}
