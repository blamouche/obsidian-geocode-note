import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
			globals: {
				navigator: "readonly",
				GeolocationPosition: "readonly",
				setTimeout: "readonly",
				clearTimeout: "readonly",
				document: "readonly",
				Blob: "readonly",
				URL: "readonly",
			},
		},
	},
]);
