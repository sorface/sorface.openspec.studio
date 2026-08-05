package tools

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAgentCapabilities(t *testing.T) {
	root := t.TempDir()
	for name, body := range map[string]string{
		"codex":    "#!/bin/sh\nif [ \"$1\" = \"debug\" ]; then echo '{\"models\":[{\"slug\":\"gpt-5.4\",\"visibility\":\"list\"},{\"slug\":\"hidden-model\",\"visibility\":\"hide\"},{\"slug\":\"gpt-5.4-mini\",\"visibility\":\"list\"}]}'; else echo codex-cli-test; fi\n",
		"gigacode": "#!/bin/sh\nif [ \"$1\" = \"--help\" ]; then echo '--non-interactive --json --cwd'; else echo gigacode-test; fi\n",
	} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", root)
	capabilities := Detect(context.Background())
	var codex, gigacode Tool
	for _, tool := range capabilities.Tools {
		switch tool.Name {
		case "codex":
			codex = tool
		case "gigacode":
			gigacode = tool
		}
	}
	if !codex.Available || codex.Supported == nil || !*codex.Supported {
		t.Fatalf("codex=%#v", codex)
	}
	if strings.Join(codex.Models, ",") != "gpt-5.4,gpt-5.4-mini" {
		t.Fatalf("codex models=%v", codex.Models)
	}
	if !gigacode.Available || gigacode.NonInteractive == nil || !*gigacode.NonInteractive {
		t.Fatalf("gigacode=%#v", gigacode)
	}
}
