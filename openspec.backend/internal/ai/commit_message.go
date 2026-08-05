package ai

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"

	processrunner "github.com/sorface/openspec-studio/backend/internal/process"
	"github.com/sorface/openspec-studio/backend/internal/taskcontext"
)

type CommitMessageGenerator struct {
	dataDir string
	runner  processrunner.Runner
	timeout time.Duration
}

const CommitMessageTimeout = 45 * time.Second

func NewCommitMessageGenerator(dataDir string) *CommitMessageGenerator {
	return &CommitMessageGenerator{dataDir: dataDir, timeout: CommitMessageTimeout}
}

func (generator *CommitMessageGenerator) Generate(ctx context.Context, input taskcontext.MessageRequest) (taskcontext.CommitMessage, error) {
	if strings.TrimSpace(input.Task) == "" || len(input.Diff) == 0 {
		return taskcontext.CommitMessage{}, ErrInvalidContext
	}
	executable, err := providerPath(input.Provider)
	if err != nil {
		return taskcontext.CommitMessage{}, err
	}
	working, err := os.MkdirTemp(generator.dataDir, "commit-message-*")
	if err != nil {
		return taskcontext.CommitMessage{}, err
	}
	defer os.RemoveAll(working)
	arguments, err := providerArguments(input.Provider, input.Model, working, "low", true)
	if err != nil {
		return taskcontext.CommitMessage{}, err
	}
	paths, _ := json.Marshal(input.Paths)
	prompt := "Сформируй на русском языке сообщение commit по точному diff OpenSpec-артефактов. " +
		"Не используй инструменты, shell или файлы. Не добавляй факты, которых нет в diff. " +
		"Ответь только JSON-объектом {\"subject\":\"...\",\"body\":\"...\"}. " +
		"Subject должен иметь точный формат \"" + input.Task + ": <короткое сообщение>\" и быть не длиннее 240 символов. " +
		"Body должен быть непустым маркированным списком фактических изменений, каждая строка начинается с \"- \".\n\n" +
		"ЗАДАЧА: " + input.Task + "\nPATHS: " + string(paths) + "\nDIFF:\n" + input.Diff
	result, runErr := generator.runner.Run(ctx, processrunner.Command{
		Executable: executable, Arguments: arguments, Directory: working, Stdin: prompt,
		Timeout: generator.timeout, MaxOutputBytes: 256 << 10,
	})
	if runErr != nil {
		return taskcontext.CommitMessage{}, runErr
	}
	response := strings.TrimSpace(finalResponse(result.Stdout))
	response = strings.TrimPrefix(response, "```json")
	response = strings.TrimPrefix(response, "```")
	response = strings.TrimSuffix(response, "```")
	var message taskcontext.CommitMessage
	if json.Unmarshal([]byte(strings.TrimSpace(response)), &message) != nil || strings.TrimSpace(message.Subject) == "" {
		return taskcontext.CommitMessage{}, errors.New("invalid commit message response")
	}
	return message, nil
}
