/** The MCP servers view of the Customizations page. */

import { useState, type ReactNode } from 'react'
import type { CustomizationsSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { ManagedMcpServer } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button,
  Checkbox,
  IconChevronDownOutlineRegular,
  IconSearchOutlineRegular,
  Input,
  StateDot,
  Switch,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { matches } from './search.ts'
import css from './CustomizationsSection.module.css'

type Server = CustomizationsSnapshot['mcpServers'][number]
type Translate = TranslateNS<'settings.customizations'>

/** What one enablement write answers, as the pane renders it. */
export type McpWriteOutcome =
  | { readonly ok: true; readonly application: 'applied' | 'restart-required' | 'overridden' }
  | { readonly ok: false; readonly message: string }

/** Localized count of one server's registered tools; a row with none never reaches here. */
function toolCount(count: number, t: Translate): string {
  return count === 1 ? t('mcpToolCount') : t('mcpToolsCount', { count })
}

/**
 * Derive one row's status line.
 *
 * The MCP client publishes no connection state, so a running row with no
 * registered tools is reported as possibly unreachable rather than connected,
 * and a row that is still retrying in the background reads as its own phase.
 */
function statusLine(server: Server, t: Translate): { state: StateDotState; text: string } {
  if (!server.enabled) return { state: 'idle', text: t('mcpStatusDisabled') }
  if (server.fiberPhase === 'failed') return { state: 'error', text: t('mcpStatusFailed') }
  if (server.fiberPhase === 'loading' || server.fiberPhase === 'pending') {
    return { state: 'ongoing', text: t('mcpStatusLoading') }
  }
  if (server.tools.length === 0) return { state: 'warning', text: t('mcpStatusEmpty') }
  return { state: 'done', text: toolCount(server.tools.length, t) }
}

/** A blank panel-managed server the add form starts from. */
function emptyServer(): ManagedMcpServer {
  return { id: '', serverName: '', transport: 'stdio', command: '', args: [], enabled: true }
}

/** What one row says about its last enablement write. */
function writeText(
  server: Server,
  t: Translate,
  write: 'busy' | 'applied' | 'restart' | 'error' | undefined,
): string {
  if (write === 'applied') return t('mcpToggleApplied')
  if (write === 'restart') return t('mcpToggleRestart')
  if (write === 'error') return t('mcpToggleFailed')
  if (!server.manageable) return t('mcpToggleLocked')
  return ''
}

/**
 * Render the MCP server rows with their registered tools.
 * @param props.t - the section's translate seat.
 * @param props.snapshot - the Host inventory this view filters.
 * @returns the search row, the server cards, or the empty state.
 */
export function McpServersList({ t, snapshot, setEnabled, addServer, removeServer, setManagedEnabled }: {
  t: Translate
  snapshot: CustomizationsSnapshot
  setEnabled: (entryId: string, enabled: boolean) => Promise<McpWriteOutcome>
  addServer: (server: ManagedMcpServer) => Promise<McpWriteOutcome>
  removeServer: (id: string) => Promise<McpWriteOutcome>
  setManagedEnabled: (id: string, enabled: boolean) => Promise<McpWriteOutcome>
}): ReactNode {
  const [query, setQuery] = useState('')
  const [writes, setWrites] = useState<Readonly<Record<string, 'busy' | 'applied' | 'restart' | 'error'>>>({})
  const [form, setForm] = useState<ManagedMcpServer>()
  const [formError, setFormError] = useState<string>()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const servers = snapshot.mcpServers.filter(server => matches(query, [
    server.serverName,
    server.target,
    server.transport,
    ...server.tools.map(tool => tool.name),
  ]))
  const cards = (
    <ul className={css.list}>
      {servers.map((server) => {
        const line = statusLine(server, t)
        const open = expanded.has(server.entryId)
        return (
          <li key={server.entryId} className={css.card}>
            <div className={css.cardHead}>
              <h3 className={css.cardTitle}>{server.serverName}</h3>
              <div className={css.cardTags}>
                <Tag tone={server.enabled ? 'success' : 'neutral'}>
                  {server.enabled ? t('mcpEnabled') : t('mcpDisabled')}
                </Tag>
                <Tag tone="outline">
                  {server.transport === 'stdio' ? t('mcpTransportStdio') : t('mcpTransportHttp')}
                </Tag>
                <Tag tone="quiet">
                  {server.origin === 'panel' ? t('originPanel') : t('originProfile')}
                </Tag>
                {server.managedId !== undefined && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void removeServer(server.managedId ?? '').then((outcome) => {
                        if (!outcome.ok) {
                          setWrites(previous => ({ ...previous, [server.entryId]: 'error' }))
                        }
                      })
                    }}
                  >
                    {t('deleteServer')}
                  </Button>
                )}
              </div>
            </div>
            <div className={css.cardMeta}>
              <span>{server.transport === 'stdio' ? t('mcpTargetCommand') : t('mcpTargetEndpoint')}</span>
              <span className={css.mono}>{server.target}</span>
            </div>
            <div className={css.cardMeta}>
              <span>{writeText(server, t, writes[server.entryId])}</span>
              <Switch
                checked={server.enabled}
                disabled={!server.manageable || writes[server.entryId] === 'busy'}
                label={t('mcpToggle', { name: server.serverName })}
                title={server.manageable ? undefined : t('mcpToggleLocked')}
                onChange={(next) => {
                  setWrites(previous => ({ ...previous, [server.entryId]: 'busy' }))
                  const call = server.origin === 'panel' && server.managedId !== undefined
                    ? setManagedEnabled(server.managedId, next)
                    : setEnabled(server.entryId, next)
                  void call.then(
                    (outcome) => {
                      setWrites(previous => ({
                        ...previous,
                        [server.entryId]: outcome.ok
                          ? (outcome.application === 'restart-required' ? 'restart' : 'applied')
                          : 'error',
                      }))
                    },
                    () => {
                      setWrites(previous => ({ ...previous, [server.entryId]: 'error' }))
                    },
                  )
                }}
              />
            </div>
            <div className={css.cardMeta}>
              <span className={css.statusWithDot}>
                <StateDot state={line.state} size={8} />
                <span>{line.text}</span>
              </span>
              {server.tools.length > 0 && (
                <button
                  type="button"
                  className={css.disclosure}
                  aria-expanded={open}
                  onClick={() => {
                    setExpanded((previous) => {
                      const next = new Set(previous)
                      if (open) next.delete(server.entryId)
                      else next.add(server.entryId)
                      return next
                    })
                  }}
                >
                  <IconChevronDownOutlineRegular size={12} />
                  {open ? t('hideTools') : t('showTools')}
                </button>
              )}
            </div>
            {open && (
              <ul className={css.toolList} aria-label={t('toolListLabel')}>
                {server.tools.map(tool => (
                  <li key={tool.name} className={css.tool}>
                    <span className={css.toolName}>{tool.name}</span>
                    <span className={css.toolDescription}>{tool.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
  return (
    <div className={css.view}>
      <div className={css.listHeader}>
        <Input
          className={css.search}
          type="search"
          icon={<IconSearchOutlineRegular size={16} />}
          value={query}
          placeholder={t('searchMcp')}
          aria-label={t('searchMcp')}
          onChange={(event) => { setQuery(event.target.value) }}
        />
        <span className={css.summary}>{t('mcpCount', { count: servers.length })}</span>
        <Button variant="outline" size="sm" onClick={() => { setForm(emptyServer()); setFormError(undefined) }}>
          {t('addOpen')}
        </Button>
      </div>
      {form !== undefined && (
        <div className={css.card}>
          <Input
            value={form.serverName}
            placeholder={t('addNamePlaceholder')}
            aria-label={t('addName')}
            onChange={(event) => { setForm({ ...form, serverName: event.target.value, id: event.target.value }) }}
          />
          <Checkbox
            checked={form.transport === 'stdio'}
            label={t('addStdio')}
            onChange={(next) => { setForm({ ...form, transport: next ? 'stdio' : 'streamable-http' }) }}
          />
          {form.transport === 'stdio' ? (
            <>
              <Input
                value={form.command ?? ''}
                placeholder={t('addCommandPlaceholder')}
                aria-label={t('addCommand')}
                onChange={(event) => { setForm({ ...form, command: event.target.value }) }}
              />
              <Input
                value={(form.args ?? []).join(' ')}
                placeholder={t('addArgsPlaceholder')}
                aria-label={t('addArgs')}
                onChange={(event) => { setForm({ ...form, args: event.target.value.split(' ').filter(Boolean) }) }}
              />
            </>
          ) : (
            <Input
              value={form.url ?? ''}
              placeholder={t('addUrlPlaceholder')}
              aria-label={t('addUrl')}
              onChange={(event) => { setForm({ ...form, url: event.target.value }) }}
            />
          )}
          {formError !== undefined && <p className={css.status} role="alert">{formError}</p>}
          <div className={css.cardTags}>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                void addServer({ ...form, id: form.serverName, enabled: true }).then((outcome) => {
                  if (outcome.ok) setForm(undefined)
                  else setFormError(t('addFailed'))
                })
              }}
            >
              {t('addSave')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setForm(undefined) }}>{t('addCancel')}</Button>
          </div>
        </div>
      )}
      {servers.length === 0
        ? <p className={css.status}>{snapshot.mcpServers.length === 0 ? t('emptyMcp') : t('emptySearch')}</p>
        : cards}
    </div>
  )
}
