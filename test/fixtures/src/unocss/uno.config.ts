import { defineConfig, presetWind3 } from "unocss";

export default defineConfig({
  presets: [presetWind3({ dark: "class" })],
  theme: { colors: { brand: { 500: "#0f62fe" } } },
  content: { filesystem: ["index.html"] },
});
