# D1: demo material

- Lane: C (Mazen) for the recording and the numbers, B (Monir) for the slide, the README section and the demo terminal, Hamza for the pitch. By hand.
- Time: 6:05 to 7:20 PM.
- Read first: the "How it should look" and "Making the demo" parts of the run sheet artifact.

## Deliverables

1. **The slide** (one slide, 16:9, Google Slides or similar):
   - Title: "Many small Gemmas, checked by the CLI".
   - Left: real numbers only. From W8: Gemma tool call correctness and valid JSON rate. From W11: problems passed, time and cost per problem. From W13: the comparison table, workflow vs one long Gemma loop on the same problems, side by side. This is the main number of the slide. No made-up numbers.
   - Right: a small diagram: chat, manager, workers, checkpoints (the CLI), verify.
   - Bottom: three rules: the CLI decides "done"; two blind solutions cross-check each other; a fresh worker on retry.
   - Footer: the GitHub link, "Runs on Gemma 4, an open model. Built in one day by Hamza, Monir and Mazen."
2. **The backup recording** of a real run on the demo problem (chosen from T1 and W11 results), during the freeze:

```bash
asciinema rec demo.cast --cols 110 --rows 34 -c "node dist/cli.js chat /tmp/demo-pairs"
agg --font-size 18 demo.cast demo.gif
```

   Keep the `.cast` too (`asciinema play -s 2 demo.cast` replays it in the terminal).
3. **README section draft** (`## Chat (preview)`): what it is, how to set the key, `polyman chat <dir>`, the keys table, one screenshot or gif. Hamza commits it.
4. **Manual testing notes** (Mazen) after each merge from 5:10: run `polyman chat` in a real terminal, write down anything that looks broken or confusing, send one list per owner (UI to Monir, the rest to Hamza).

## Done when

The slide is ready with real numbers, the recording plays, and the README draft is sent.
