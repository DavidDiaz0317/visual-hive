# Visual Hive Site

This workspace is the static public information and onboarding site for Visual Hive. It is separate from the local-first Control Plane UI in `packages/control-plane`.

## Local development

```bash
npm run site:dev
npm run site:typecheck
npm run site:build
```

## Vercel deployment

Create a Vercel project with the root directory set to `apps/visual-hive-site`.

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`

From this directory, a linked project can be deployed with:

```bash
npx vercel
npx vercel --prod
```

Do not commit `.vercel/` project metadata.
