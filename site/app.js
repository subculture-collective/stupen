// The help-limit demo and nothing else: the page reads fully without this file.
(() => {
  const group = document.querySelector("[data-steps]");
  if (!group) return;
  const steps = [...group.querySelectorAll("[role=radio]")];
  const reply = document.querySelector("[data-reply]");
  const label = document.querySelector("[data-level-label]");
  const NAMES = ["questions only", "point", "explain", "diagnose", "direct", "fragment", "solve"];
  // Written for the demo; the real coach answers the learner's own work.
  const REPLIES = [
    'What do you think the two keys in your result have in common? What did you expect them to look like?',
    'Look at the keys in your result, not the counts. The test name is a clue.',
    'The test expects words without punctuation. Splitting on spaces keeps a comma or an exclamation mark attached to a word, and then "hi," and "hi!" count as different words.',
    'Your split leaves punctuation on the words, so "hi," and "hi!" are different keys. Lower-casing them is fine; the punctuation is what is wrong.',
    'Before counting, remove the punctuation from each word, then skip any word that ends up empty. Count what is left.',
    'One way to clean a word is word.strip(string.punctuation). Apply it to each word before you count it.',
    'That closes the attempt. One solution: words = (w.strip(string.punctuation).lower() for w in text.split()), then return dict(Counter(w for w in words if w)). Now explain in your own words why the strip is needed, and try the next exercise.',
  ];
  function choose(level, focus) {
    steps.forEach((s, i) => {
      s.setAttribute("aria-checked", String(i === level));
      s.tabIndex = i === level ? 0 : -1;
      s.classList.toggle("above", i > level);
    });
    reply.textContent = REPLIES[level];
    label.textContent = `help ${level} · ${NAMES[level]}`;
    if (focus) steps[level].focus();
  }
  steps.forEach((s, i) => {
    s.addEventListener("click", () => choose(i, false));
    s.addEventListener("keydown", (e) => {
      const next = { ArrowRight: i + 1, ArrowUp: i + 1, ArrowLeft: i - 1, ArrowDown: i - 1, Home: 0, End: 6 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      choose(Math.max(0, Math.min(6, next)), true);
    });
  });
  choose(3, false);
})();
