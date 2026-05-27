const COLORS: Record<string, string> = {
  "Google Gemini":    "#4285F4",
  "Anthropic Claude": "#E8540A",
  "OpenAI":           "#10A37F",
  "LangChain":        "#4ECDC4",
  "PyTorch":          "#EE4C2C",
  "Mistral":          "#7C3AED",
  "Ollama":           "#6B7280",
  "Terraform":        "#5C4EE5",
  "Pandas/NumPy":     "#F59E0B",
  "React/Figma":      "#06B6D4",
  "Pytest/Selenium":  "#84CC16",
  "OWASP":            "#F43F5E",
  "custom":           "#94A3B8",
  // legacy lowercase values stored by existing dropdown
  "claude":           "#E8540A",
  "langchain":        "#4ECDC4",
  "autogen":          "#6B7280",
};

export function frameworkColor(framework: string): string {
  return COLORS[framework] ?? "#94A3B8";
}
