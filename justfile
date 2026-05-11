set shell := ["zsh", "-cu"]

install_dir := env_var_or_default("FILECUBBY_INSTALL_DIR", `printf "%s/.local/bin" "$HOME"`)

default:
    just --list

build:
    cd cli && go build -ldflags="-s -w" -o filecubby .

install:
    mkdir -p "{{install_dir}}"
    cd cli && go build -ldflags="-s -w" -o "{{install_dir}}/filecubby" .
    "{{install_dir}}/filecubby" --help >/dev/null
    echo "Installed {{install_dir}}/filecubby"

test:
    cd cli && go test ./...
