### Fixed

- Town draws one wall around a team's touching tables, bending it around
  another team's table instead of splitting into a box per table. Separate
  clusters of one team in a room get a wall each, joined by a connector.
- Joining a team in Town moves no other table: the dropped table takes a free
  place touching the table it was dropped on, on the side it came from where
  it can, so an L built table by table keeps its shape.
