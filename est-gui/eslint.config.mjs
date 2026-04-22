import eslint from "@electron-toolkit/eslint-config";
import eslintConfigPrettier from "@electron-toolkit/eslint-config-prettier";
import eslintPluginReact from "eslint-plugin-react";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import eslintPluginReactRefresh from "eslint-plugin-react-refresh";
import eslintPluginSimpleImportSort from "eslint-plugin-simple-import-sort";

export default [
    {
        ignores: ["**/node_modules", "**/dist", "**/out", "**/components/ui"]
    },
    eslint,
    eslintPluginReact.configs.flat.recommended,
    eslintPluginReact.configs.flat["jsx-runtime"],
    {
        settings: {
            react: {
                version: "detect"
            }
        }
    },
    {
        files: ["**/*.{js,jsx}"],
        plugins: {
            "react-hooks": eslintPluginReactHooks,
            "react-refresh": eslintPluginReactRefresh,
            "simple-import-sort": eslintPluginSimpleImportSort
        },
        rules: {
            ...eslintPluginReactHooks.configs.recommended.rules,
            ...eslintPluginReactRefresh.configs.vite.rules,
            "react/prop-types": "off",
            "simple-import-sort/imports": [
                "error",
                {
                    groups: [["^\\u0000", "^react$", "^(?!@/|\\.)", "^@/components/ui(/.*|$)", "^@/lib(/.*|$)", "^@/components(/.*|$)", "^@/views(/.*|$)", "^@/stores(/.*|$)", "^@/", "^\\."]]
                }
            ],
            "simple-import-sort/exports": "error"
        }
    },
    eslintConfigPrettier
];
