// web/src/Board.jsx
import Sidebar from './Sidebar.jsx'
import ProjectPanel from './ProjectPanel.jsx'

export default function Board({
  projects, selectedCwd, showAll, connected,
  onSelect, onSettings, onToggleShowAll,
  onUpdate, onFocus, onKill,
  selectedProject,
}) {
  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minWidth: 0 }}>
      <Sidebar
        projects={projects}
        selectedCwd={selectedCwd}
        connected={connected}
        onSelect={onSelect}
        onSettings={onSettings}
      />
      {selectedProject ? (
        <ProjectPanel
          key={selectedProject.cwd}
          project={selectedProject}
          showAll={showAll.has(selectedProject.cwd)}
          onToggleShowAll={() => onToggleShowAll(selectedProject.cwd)}
          onUpdate={patch => onUpdate(selectedProject.sessions[0].fileKey, patch)}
          onFocus={onFocus}
          onKill={onKill}
        />
      ) : (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 12,
        }}>
          — no active sessions
        </div>
      )}
    </div>
  )
}
