/** The instruction-chain view of the Customizations page. */

import { useState, type ReactNode } from 'react'
import type { CustomizationsSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { IconSearchOutlineRegular, Input, Tag, fileSizeText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { matches } from './search.ts'
import css from './CustomizationsSection.module.css'

type Translate = TranslateNS<'settings.customizations'>

/**
 * Render the instruction files this workspace's agents load.
 * @param props.t - the section's translate seat.
 * @param props.snapshot - the Host inventory this view filters.
 * @returns the search row, the file cards, or the empty state.
 */
export function RulesList({ t, snapshot }: {
  t: Translate
  snapshot: CustomizationsSnapshot
}): ReactNode {
  const [query, setQuery] = useState('')
  const rules = snapshot.rules.filter(rule => matches(query, [rule.name, rule.path, rule.scope]))
  const summary = snapshot.rulesTruncated
    ? `${t('rulesCount', { count: rules.length })} · ${t('truncated', { count: snapshot.rules.length })}`
    : t('rulesCount', { count: rules.length })
  const cards = (
    <ul className={css.list}>
      {rules.map(rule => (
        <li key={rule.path} className={css.card}>
          <div className={css.cardHead}>
            <h3 className={css.cardTitle}>{rule.name}</h3>
            <div className={css.cardTags}>
              <Tag tone={rule.scope === 'user' ? 'info' : 'neutral'}>
                {rule.scope === 'user' ? t('ruleUser') : t('ruleProject')}
              </Tag>
            </div>
          </div>
          <div className={css.cardMeta}>
            <span className={css.mono}>{rule.path}</span>
            <span>{fileSizeText(rule.bytes)}</span>
          </div>
        </li>
      ))}
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
          placeholder={t('searchRules')}
          aria-label={t('searchRules')}
          onChange={(event) => { setQuery(event.target.value) }}
        />
        <span className={css.summary}>{summary}</span>
      </div>
      {rules.length === 0 ? <p className={css.status}>{t('emptyRules')}</p> : cards}
    </div>
  )
}
