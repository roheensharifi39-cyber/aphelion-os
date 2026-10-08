import type { Agent, ModelCatalog } from '../types';
export function effortChoices(catalog: ModelCatalog[Agent] | undefined, model: string): string[] {
  return (catalog?.models.find(option => option.id === model) || (model === 'auto' ? catalog?.models.find(option => option.isDefault) : undefined))?.efforts || [];
}
export function AgentPreferences({ agent, catalog, model, reasoning, disabled, change }: { agent: Agent; catalog?: ModelCatalog[Agent]; model: string; reasoning: string; disabled?: boolean; change: (model: string, reasoning: string) => void }) {
  const name = agent === 'claude' ? 'Claude' : 'Codex', choices = catalog?.models.filter(option => option.id !== 'auto') || [], efforts = effortChoices(catalog, model);
  const validEffort = reasoning === 'auto' || efforts.includes(reasoning);
  return <div className="agent-preferences"><label><span>MODEL</span><select aria-label={`${name} model`} value={model} disabled={disabled} onChange={event => { const next = event.target.value; change(next, reasoning === 'auto' || effortChoices(catalog, next).includes(reasoning) ? reasoning : 'auto'); }}><option value="auto">Auto · subscription default</option>{choices.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}{model !== 'auto' && !choices.some(option => option.id === model) && <option value={model}>{model} · saved model</option>}</select></label>
    <label><span>REASONING</span><select aria-label={`${name} reasoning`} value={reasoning} disabled={disabled || !catalog} onChange={event => change(model, event.target.value)}><option value="auto">Auto · model default</option>{efforts.map(effort => <option key={effort} value={effort}>{({ xhigh: 'Extra high', ultra: 'Ultra', max: 'Maximum', none: 'None' } as Record<string, string>)[effort] || effort[0].toUpperCase() + effort.slice(1)}</option>)}{!validEffort && <option value={reasoning} disabled>{reasoning} · choose a supported level</option>}</select></label>{catalog?.error && <p className="catalog-error">{catalog.error}</p>}
  </div>;
}
