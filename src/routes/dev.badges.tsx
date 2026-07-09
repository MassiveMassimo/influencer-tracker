// Dev-only gallery for eyeballing every trait badge + grade-medallion persona and
// any combination of the two. DEV-gated (throws notFound in prod builds), so it
// never ships or gets crawled. Reuses the real Badge / GradeDetail components so
// what you see here is what the creator header renders.
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { ALL_TRAITS } from "#/lib/traits";
import { BadgeShape } from "#/components/trait-badges";
import { GradeDetail } from "#/components/grade-detail";
import { IdentityMenu } from "#/components/identity-menu";
import { PERSONA_BLURB, type Grade } from "#/lib/grade";

export const Route = createFileRoute("/dev/badges")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: DevBadges,
});

// Persona → letter, straight from personaFor's switch (grade.ts). Order preserved.
const PERSONAS: { letter: Grade["letter"]; label: string }[] = [
  ...(["The Sniper", "Ten-Bagger Hunter", "Batting .700", "Money Printer"] as const).map(
    (label) => ({ letter: "A" as const, label }),
  ),
  ...(["Base Hit Merchant", "The Grinder", "The Compounder", "Positive Expectancy"] as const).map(
    (label) => ({ letter: "B" as const, label }),
  ),
  ...(["SPY in a Trenchcoat", "The Wash Trade", "Noise Trader", "Dartboard Monkey"] as const).map(
    (label) => ({ letter: "C" as const, label }),
  ),
  ...(["Exit Liquidity", "Dead Cat Bouncer", "FOMO Merchant", "Knife Catcher"] as const).map(
    (label) => ({ letter: "D" as const, label }),
  ),
  ...(["The Costanza", "Reverse Midas", "GUH", "Inverse Cramer"] as const).map((label) => ({
    letter: "F" as const,
    label,
  })),
];

// Representative score per letter (mid-band) — the medallion only reads grade/label,
// the breakdown numbers below are plausible fillers for this gallery.
const SCORE: Record<Grade["letter"], { grade: string; score: number }> = {
  A: { grade: "A", score: 88 },
  B: { grade: "B", score: 67 },
  C: { grade: "C", score: 50 },
  D: { grade: "D", score: 26 },
  F: { grade: "F", score: 10 },
};

function fakeGrade(letter: Grade["letter"], label: string): Grade {
  const { grade, score } = SCORE[letter];
  return {
    grade,
    letter,
    label,
    score,
    detail: {
      pooledHit: score / 100,
      pooledExcess: (score - 50) / 500,
      hitPoints: score - 50,
      excessPoints: 0,
      scoredN: 42,
    },
  };
}

function DevBadges() {
  const [persona, setPersona] = useState(PERSONAS[3]); // Money Printer
  const [on, setOn] = useState<Record<string, boolean>>(
    Object.fromEntries(ALL_TRAITS.map((t) => [t.id, true])),
  );
  const comboGrade = fakeGrade(persona.letter, persona.label);
  const comboTraits = ALL_TRAITS.filter((t) => on[t.id]);

  return (
    <div className="mx-auto max-w-4xl space-y-12 px-6 py-10">
      <header>
        <h1 className="font-heading text-2xl">Badge &amp; medallion gallery</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dev-only. Every trait badge, every persona medallion, and a live combo below.
        </p>
      </header>

      {/* Live combo: pick a persona, toggle traits, see the header row. */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg">Combo</h2>
        <div className="flex flex-wrap items-center justify-end gap-4 rounded-xl border border-border/60 bg-muted/20 p-6">
          {/* The real desktop shared-morph menu (badges + medallion, one popup). */}
          <IdentityMenu grade={comboGrade} traits={comboTraits} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Persona:</span>
          <select
            className="rounded-md border border-border/60 bg-background px-2 py-1"
            value={persona.label}
            onChange={(e) =>
              setPersona(PERSONAS.find((p) => p.label === e.target.value) ?? PERSONAS[0])
            }
          >
            {PERSONAS.map((p) => (
              <option key={p.label} value={p.label}>
                {p.letter} — {p.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-3">
          {ALL_TRAITS.map((t) => (
            <label key={t.id} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={!!on[t.id]}
                onChange={(e) => setOn((s) => ({ ...s, [t.id]: e.target.checked }))}
              />
              {t.name}
            </label>
          ))}
        </div>
      </section>

      {/* Every trait badge with its blurb. */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg">All trait badges ({ALL_TRAITS.length})</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {ALL_TRAITS.map((t) => (
            <div
              key={t.id}
              className="flex items-start gap-3 rounded-xl border border-border/50 p-4"
            >
              <BadgeShape trait={t} />
              <div className="min-w-0">
                <div className="font-heading text-sm">
                  {t.name}{" "}
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {t.shape}/{t.hue}
                  </span>
                </div>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                  {t.blurb}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Every persona medallion (hover/tap for the real breakdown card). */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg">All persona medallions ({PERSONAS.length})</h2>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4">
          {PERSONAS.map((p) => (
            <div key={p.label} className="flex flex-col items-center gap-2 text-center">
              <GradeDetail grade={fakeGrade(p.letter, p.label)} />
              <div className="text-xs font-medium">{p.label}</div>
              <div className="text-[11px] text-muted-foreground">{PERSONA_BLURB[p.label]}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
