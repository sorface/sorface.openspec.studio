package config

import (
	"errors"
	"flag"
	"fmt"
	"net"
	"os"
	"path/filepath"
)

type Config struct {
	Address   string
	DataDir   string
	NoBrowser bool
}

func Parse() (Config, error) {
	defaultDir, err := defaultDataDir()
	if err != nil {
		return Config{}, err
	}

	var result Config
	flag.StringVar(&result.Address, "address", "127.0.0.1:0", "loopback address for the local server")
	flag.StringVar(&result.DataDir, "data-dir", defaultDir, "directory for local application data")
	flag.BoolVar(&result.NoBrowser, "no-browser", false, "do not open the browser automatically")
	flag.Parse()

	host, _, err := net.SplitHostPort(result.Address)
	if err != nil {
		return Config{}, fmt.Errorf("invalid address: %w", err)
	}
	ip := net.ParseIP(host)
	if host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return Config{}, errors.New("server address must use a loopback interface")
	}
	result.DataDir, err = filepath.Abs(result.DataDir)
	return result, err
}

func defaultDataDir() (string, error) {
	root, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve user home directory: %w", err)
	}
	return filepath.Join(root, ".osstudio"), nil
}
