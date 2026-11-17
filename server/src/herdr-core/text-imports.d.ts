// Bun's `with { type: "text" }` import: the file's text, embedded in the binary.
declare module "*.sh" {
  const text: string;
  export default text;
}
declare module "*.ps1" {
  const text: string;
  export default text;
}
