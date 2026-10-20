// The replay pane's diff region: the step's diff lines, drawn in a Client so the
// arrow keys reach the mod once the region has the focus (a click gives it).
// ↑ asks for the next step, ↓ for the previous one; the hooks module moves.

export default function ReplayDiff(props, surface) {
  const { Box, Text } = surface.elements;
  if (surface.state === undefined) {
    surface.onKey((k) => {
      if (k.key === "up") surface.post({ step: 1 });
      else if (k.key === "down") surface.post({ step: -1 });
    });
    surface.setState({ isListening: true });
  }
  const rows = Array.isArray(props?.rows) ? props.rows : [];
  return Box({
    flexDirection: "column",
    children: rows.map((r, n) =>
      Text({ key: `d${n}`, color: r.color, dimColor: r.dim, wrap: "truncate-end", children: r.text })),
  });
}
