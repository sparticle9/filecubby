package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var cfgFile string
var verbose bool

func main() {
	var rootCmd = &cobra.Command{Use: "tgpan"}

	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default is ./config.yml)")
	rootCmd.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false, "verbose output")

	var ufCmd = &cobra.Command{
		Use:   "uf <filepath>",
		Short: "Upload file",
		Args:  cobra.ExactArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			uploadFile(args[0], "drive", verbose)
		},
	}

	var uiCmd = &cobra.Command{
		Use:   "ui [filepath]",
		Short: "Upload image from clipboard or file",
		Args:  cobra.MaximumNArgs(1),
		Run: func(cmd *cobra.Command, args []string) {
			if len(args) == 0 {
				uploadImageFromClipboard(verbose)
			} else {
				uploadFile(args[0], "image", verbose)
			}
		},
	}

	rootCmd.AddCommand(ufCmd, uiCmd)

	cobra.OnInitialize(initConfig)

	if err := rootCmd.Execute(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}

func initConfig() {
	if cfgFile != "" {
		// Use config file from the flag.
		viper.SetConfigFile(cfgFile)
	} else {
		// Search config in current directory with name "config.yml"
		viper.AddConfigPath(".")
		viper.SetConfigName("config")
		viper.SetConfigType("yml")
	}

	viper.AutomaticEnv() // read in environment variables that match

	// If a config file is found, read it in.
	//only println the config file path with verbose on
	if err := viper.ReadInConfig(); err == nil {
		if verbose {
			fmt.Println("Using config file:", viper.ConfigFileUsed())
		}
	} else {
		fmt.Println("Error reading config file:", err)
		os.Exit(1)
	}
}
