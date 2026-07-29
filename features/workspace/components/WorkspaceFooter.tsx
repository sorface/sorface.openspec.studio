interface WorkspaceFooterProps {
  onCommit: () => void;
}

export function WorkspaceFooter({ onCommit }: WorkspaceFooterProps) {
  return (
    <nav className="bottom-bar">
      <button className="active"><span>⌁</span><b>Git</b><em>4</em></button>
      <button><span>◇</span><b>OpenSpec</b></button>
      <button><span>◴</span><b>Операции</b><em className="running">1</em></button>
      <div className="bottom-spacer" />
      <span className="validation"><i /> Последняя проверка: успешно · 2 мин назад</span>
      <button className="commit-button" onClick={onCommit}>Commit & Push</button>
    </nav>
  );
}
