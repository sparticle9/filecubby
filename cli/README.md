# tgpan CLI

tgpan CLI is a command-line interface tool for uploading files and images to the tgpan service.

## Build from source

### Option 1: Simple Go build

1. Ensure you have Go installed on your system.
2. Clone the repository:
   ```
   git clone https://github.com/yourusername/tgpan-cli.git
   cd tgpan-cli/cli
   ```
3. Build the CLI:
   ```
   go build -ldflags="-s -w" -o tgpan .
   ```

### Option 2: Using GoReleaser

1. Install GoReleaser (if not already installed):
   ```
   go install github.com/goreleaser/goreleaser@latest
   ```

2. Clone the repository (if you haven't already):
   ```
   git clone https://github.com/yourusername/tgpan-cli.git
   cd tgpan-cli/cli
   ```

3. Build and package the CLI:
   ```
   goreleaser build --snapshot --rm-dist
   ```

4. The built binaries will be in the `dist` directory. You can find the appropriate binary for your system:
   - For macOS: `dist/tgpan_darwin_amd64/tgpan` or `dist/tgpan_darwin_arm64/tgpan`
   - For Linux: `dist/tgpan_linux_amd64/tgpan` or `dist/tgpan_linux_arm64/tgpan`

5. Copy the appropriate binary and the `config.yml` file to your desired location.

## Configuration

Before using the CLI, make sure to set up your `config.yml` file in the same directory as the executable. `config.yml.example` can be used as a template.


## Features

- File upload support
- Image upload from file or clipboard
- Chunked uploads for large files
- Image size limit enforcement
- Accurate MIME type detection
- Verbose mode for debugging
- Custom configuration file support

## Dependencies

- github.com/spf13/cobra
- github.com/spf13/viper
- golang.design/x/clipboard
- github.com/gabriel-vasile/mimetype
