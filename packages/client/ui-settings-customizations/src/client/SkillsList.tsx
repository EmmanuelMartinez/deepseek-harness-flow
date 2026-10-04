/** The Skills view of the Customizations page. */

import { useState, type ReactNode } from 'react'
import type { CustomizationsSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { IconSearchOutlineRegular, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { matches } from './search.ts'
import type { CustomizationsLocaleKey } from './locales.ts'
import css from './CustomizationsSection.module.css'

type Translate = TranslateNS<'settings.customizations'>

/**
 * Discovery roots as the skill registry names them, mapped to dictionary keys.
 * A source outside this table is shown verbatim instead of being dropped.
 */
const SOURCE_KEYS = {
  'project-dsh': 'sourceProjectDsh',
  'project-agents': 'sourceProjectAgents',
  custom: 'sourceCustom',
  'user-dsh': 'sourceUserDsh',
  'user-agents': 'sourceUserAgents',
  bundled: 'sourceBundled',
  runtime: 'sourceRuntime',
} as const satisfies Record<string, CustomizationsLocaleKey>

/** Localized name of one skill's discovery root. */
function sourceLabel(source: string, t: Translate): string {
  const key = (SOURCE_KEYS as Record<string, CustomizationsLocaleKey | undefined>)[source]
  return key === undefined ? source : t(key)
}

/**
 * Render the merged skill catalog.
 * @param props.t - the section's translate seat.
 * @param props.snapshot - the Host inventory this view filters.
 * @returns the search row, the skill cards, or the empty state.
 */
export function SkillsList({ t, snapshot }: {
  t: Translate
  snapshot: CustomizationsSnapshot
}): ReactNode {
  const [query, setQuery] = useState('')
  const skills = snapshot.skills.filter(skill => matches(query, [
    skill.name,
    skill.description,
    skill.whenToUse,
    skill.path,
    skill.source,
    ...skill.presets,
  ]))
  if (!snapshot.skillsAvailable) return <p className={css.status}>{t('skillsUnavailable')}</p>
  const summary = snapshot.skillsTruncated
    ? `${t('skillsCount', { count: skills.length })} · ${t('truncated', { count: snapshot.skills.length })}`
    : t('skillsCount', { count: skills.length })
  return (
    <div className={css.view}>
      <div className={css.listHeader}>
        <Input
          className={css.search}
          type="search"
          icon={<IconSearchOutlineRegular size={16} />}
          value={query}
          placeholder={t('searchSkills')}
          aria-label={t('searchSkills')}
          onChange={(event) => { setQuery(event.target.value) }}
        />
        <span className={css.summary}>{summary}</span>
      </div>
      {skills.length === 0
        ? <p className={css.status}>{snapshot.skills.length === 0 ? t('emptySkills') : t('emptySearch')}</p>
        : (
          <ul className={css.list}>
            {skills.map(skill => (
              <li key={`${skill.name}:${skill.path ?? ''}`} className={css.card}>
                <div className={css.cardHead}>
                  <h3 className={css.cardTitle}>{skill.name}</h3>
                  <div className={css.cardTags}>
                    <Tag tone="neutral">{sourceLabel(skill.source, t)}</Tag>
                    {skill.modelInvocable && <Tag tone="quiet">{t('modelTag')}</Tag>}
                    {skill.userInvocable && <Tag tone="quiet">{t('userTag')}</Tag>}
                  </div>
                </div>
                <p className={css.cardDescription}>{skill.description}</p>
                <div className={css.cardMeta}>
                  {skill.presets.length > 0 && (
                    <span>{`${t('presetsLabel')}: ${skill.presets.join(', ')}`}</span>
                  )}
                  {skill.path !== undefined && <span className={css.mono}>{skill.path}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
