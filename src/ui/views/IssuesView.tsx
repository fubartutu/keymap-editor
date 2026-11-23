import type { Issue } from '../../core/validate.ts'
import type { Ctx } from '../context.ts'
import type { Store } from '../store.ts'

export function IssuesView({ store, onOpen }: { ctx: Ctx; store: Store; onOpen: (i: Issue) => void }) {
  const order = { error: 0, warning: 1, info: 2 }
  const list = [...store.issues].sort((a, b) => order[a.severity] - order[b.severity])
  return (
    <div className="page">
      <h1>Problems</h1>
      <p className="lead">Checked live as you edit. Errors stop the firmware from building; warnings are probably mistakes. Click one to go to it.</p>
      <div className="card">
        {list.length === 0 ? <div className="empty">No problems found.</div> : (
          <div className="issues" style={{ padding: 8 }}>
            {list.map((i, k) => (
              <div key={k} className={`issue ${i.severity}`} onClick={() => onOpen(i)}>
                <span className="sev">{i.severity}</span><span>{i.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {store.firmwareCheck && (
        <div className="card" style={{ marginTop: 16 }}>
          <header><h2>Firmware check</h2>{store.firmwareCheck.ok ? <span className="pill ok">passed</span> : <span className="pill err">failed</span>}</header>
          {!store.firmwareCheck.ok && <pre className="code">{(store.firmwareCheck.errors ?? []).join('\n')}</pre>}
        </div>
      )}
    </div>
  )
}
