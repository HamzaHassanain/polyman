# GitHub Pages Setup Guide

Follow these steps to enable GitHub Pages for your JSDoc documentation:

## 1. Enable GitHub Pages in Repository Settings

1. Go to your repository on GitHub: `https://github.com/hamzahassanain/polyman`
2. Click on **Settings** (top navigation bar)
3. Scroll down and click on **Pages** (left sidebar)

## 2. Configure GitHub Pages Source

In the **Build and deployment** section:

- **Source**: Select `GitHub Actions` from the dropdown
- This will allow the `.github/deploy.yaml` workflow to deploy documentation

## 3. Push Changes to Master Branch

Once you push to the `master` branch, the GitHub Actions workflow will:

1. Install Node.js and dependencies
2. Generate JSDoc documentation to `./docs`
3. Deploy to GitHub Pages

## 4. Access Your Documentation

After the first successful deployment, your documentation will be available at:

```
https://hamzahassanain.github.io/polyman/
```

## 5. Monitor Deployment

- Go to the **Actions** tab in your repository
- Watch the "Deploy JsDocs to GitHub Pages" workflow
- It should complete successfully after a few minutes
- Any errors will be shown in the workflow logs

## Local Testing

Before pushing, you can test the documentation locally:

```bash
# Generate documentation
npm run docs

# Generate and serve documentation locally
npm run docs:serve
```

This will open the documentation at `http://localhost:8080`

## Troubleshooting

### If the workflow fails:

1. Check the Actions tab for error logs
2. Ensure all dependencies are in `package.json`
3. Make sure `jsdoc.json` configuration is correct

### If pages don't update:

1. Wait a few minutes after deployment
2. Clear browser cache
3. Check GitHub Pages settings are set to "GitHub Actions"

### If styling looks broken:

1. Verify `.nojekyll` file is created in the workflow
2. Check that all assets are properly referenced in JSDoc output

## Optional: Custom Domain

If you want to use a custom domain:

1. In GitHub Pages settings, add your custom domain
2. Configure DNS records with your domain provider
3. Enable "Enforce HTTPS"

---

**Note**: The first deployment might take a few minutes. Subsequent deployments are usually faster.
