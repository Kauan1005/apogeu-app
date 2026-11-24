"use client";
import { useState, useTransition } from "react";
import { Icon, Money } from "@/components/ui";
import { notify } from "@/components/notify";
import { linkGoalPots, setPotHidden } from "../actions";
import type { PotGroup, PotItem } from "@/lib/phase2";

/** Lista os cofrinhos por banco. Cada item pode ser ocultado se não for um cofrinho (com Desfazer). */
export function CofrinhoList({ groups, hiddenCount }: { groups: PotGroup[]; hiddenCount: number }) {
  const [showHidden, setShowHidden] = useState(false);
  const [pending, start] = useTransition();
  const toggle = (i: PotItem, hide: boolean) => start(async () => {
    await setPotHidden(i.kind, i.id, hide);
    notify(hide ? `“${i.name}” oculto dos cofrinhos` : `“${i.name}” voltou aos cofrinhos`, () => setPotHidden(i.kind, i.id, !hide));
  });
  return (
    <div className="pots">
      {groups.map((g) => {
        const shown = g.items.filter((i) => showHidden || !i.hidden);
        if (!shown.length) return null;
        return (
          <div className="pot-group" key={g.bank}>
            <div className="pot-bank">
              <span>{g.bank}</span><span className="sp" />
              {g.items.filter((i) => !i.hidden).length > 1 && <span className="num"><Money cents={g.cents} /></span>}
            </div>
            {shown.map((i) => (
              <div className={`pot-row${i.hidden ? " off" : ""}`} key={i.key}>
                <span className="pot-name">{i.name}{i.rate ? <span className="muted t-xs"> · {Math.round(i.rate)}% do CDI</span> : null}</span>
                <span className="num"><Money cents={i.cents} /></span>
                <button className="btn ghost icon" disabled={pending} onClick={() => toggle(i, !i.hidden)}
                  aria-label={i.hidden ? `Mostrar ${i.name} nos cofrinhos` : `Ocultar ${i.name}: não é um cofrinho`} title={i.hidden ? "Mostrar" : "Não é um cofrinho"}>
                  <Icon name={i.hidden ? "eye" : "eyeoff"} size="sm" />
                </button>
              </div>
            ))}
          </div>
        );
      })}
      {hiddenCount > 0 && (
        <button className="btn ghost" style={{ justifySelf: "start" }} onClick={() => setShowHidden((v) => !v)} aria-pressed={showHidden}>
          {showHidden ? "Esconder os ocultos" : `Mostrar ${hiddenCount} ${hiddenCount === 1 ? "oculto" : "ocultos"}`}
        </button>
      )}
    </div>
  );
}

export type PotOption = { ref: string; label: string; cents: number };

/** Liga uma meta a um ou mais cofrinhos: o progresso passa a ser o saldo deles. */
export function GoalPots({ goalId, options, selected }: { goalId: string; options: PotOption[]; selected: string[] }) {
  const [sel, setSel] = useState<string[]>(selected);
  const [pending, start] = useTransition();
  const linked = selected.filter((r) => options.some((o) => o.ref === r)).length;
  if (!options.length && !linked) return null;
  return (
    <details className="goal-pots">
      <summary>{linked ? `Ligada a ${linked} ${linked === 1 ? "cofrinho" : "cofrinhos"}` : "Ligar a um cofrinho"}</summary>
      <div className="goal-pots-list">
        {options.map((o) => (
          <label key={o.ref} className="goal-pot">
            <input type="checkbox" checked={sel.includes(o.ref)} onChange={(e) => setSel((v) => (e.target.checked ? [...v, o.ref] : v.filter((x) => x !== o.ref)))} />
            <span className="goal-pot-name">{o.label}</span><span className="num t-xs muted"><Money cents={o.cents} /></span>
          </label>
        ))}
        <button className="btn" disabled={pending} style={{ justifySelf: "start" }} onClick={() => start(async () => {
          await linkGoalPots(goalId, sel);
          notify(sel.length ? "Meta ligada: o progresso agora vem do cofrinho" : "Meta desligada dos cofrinhos");
        })}><Icon name="check" size="sm" />Salvar</button>
      </div>
    </details>
  );
}
