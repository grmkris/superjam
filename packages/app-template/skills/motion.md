# SKILL motion — animated, expensive-feeling UI

Dep: `motion` (the library formerly framer-motion). Use for list/card apps that
should feel polished — entrances, springs, reorder. For games use the loop
patterns in game-2d/game-3d instead; for one-off blips the CSS classes
`.tj-pop` / `.tj-shake` are cheaper.

## RULES
1. Import from `"motion/react"`: `import { motion, AnimatePresence } from "motion/react"`.
2. Animate transform/opacity only (never width/height/top — jank).
3. Springs for interactive feedback, durations ≤ 0.3s — snappy, not floaty.
4. `AnimatePresence` + a stable `key` for enter/exit of list rows and modals.

## Recipes

```tsx
import { AnimatePresence, motion } from "motion/react";
import type { Doc } from "@superjam/sdk";

// list rows spring in / fade out (guestbooks, feeds, todo lists)
// docs come from sdk.data.collection(...).list() — fields under d.data
<ul className="tj-list">
  <AnimatePresence initial={false}>
    {docs.map((d: Doc) => (
      <motion.li key={d.id}
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, x: -24 }}
        transition={{ type: "spring", stiffness: 500, damping: 32 }}>
        <b>@{d.username}</b> {String(d.data.text)}
      </motion.li>
    ))}
  </AnimatePresence>
</ul>

// tap feedback on any button
<motion.button className="tj-btn" whileTap={{ scale: 0.94 }} onClick={go}>Go</motion.button>

// number that pops when it changes
<motion.div key={score} className="tj-stat"
  initial={{ scale: 1.4 }} animate={{ scale: 1 }}
  transition={{ type: "spring", stiffness: 600, damping: 20 }}>
  {score}
</motion.div>

// modal / result card
<AnimatePresence>
  {open && (
    <motion.div className="tj-card"
      initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }} />
  )}
</AnimatePresence>
```
