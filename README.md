# Countact
### Your contacts, accounted for.

Countact is a smart contact lens dispenser concept and companion web app designed to help users organize their lenses, track their supply, and know when to reorder. Created for the AKPsi Countact project.

## Live Website

**[Visit Countact](https://akspi-countact.onrender.com)**

**[Explore the Shop](https://akspi-countact.onrender.com/shop)**

## About the Product

Countact’s proposed design stores sealed contact lens strips in separate left and right compartments, supporting different prescriptions for each eye. Its companion app experience helps users monitor their remaining supply and plan reorders.

This website demonstrates the product concept. Product illustrations and app interactions do not represent a verified connection to physical dispenser hardware.

## Features

- Responsive website for desktop and mobile devices.
- Product illustrations, mechanism explanations, and demo video.
- Interactive companion app demo with separate left and right inventory counts.
- Dispenser shop, shopping cart, and order confirmation pages.
- Stripe Checkout integration with server-side payment verification.
- Optional Amazon Multi-Channel Fulfillment integration.
- Configurable external retailer link for reordering contact lenses.

Payment and fulfillment features require configuration and credentials before they can operate.

## Technology Stack

| Area | Technology |
| --- | --- |
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js, Express |
| Payments | Stripe Checkout and webhooks |
| Optional fulfillment | Amazon Selling Partner API / MCF |
| Order storage | File-backed JSON storage |
| Hosting | Render |

## Local Setup

Install Node.js compatible with `package.json`, then run:

```bash
git clone https://github.com/sudiksa1307/AKSPI-Countact.git
cd AKSPI-Countact
npm ci
cp .env.example .env
npm start
```

Open http://localhost:4242 to view the website.

Update `.env` with your configuration. Use Stripe test credentials during development. Never commit API keys or `.env` files.

See [docs/SETUP.md](docs/SETUP.md) for detailed instructions.

## Deployment

The website is hosted on Render as a Node.js Web Service.

| Setting | Value |
| --- | --- |
| Build command | `npm ci` |
| Start command | `npm start` |
| Site URL | `https://akspi-countact.onrender.com` |

Set `SITE_URL` to the public website URL in the hosting environment. The server uses the host-provided `PORT`.

Before accepting real orders, configure Stripe and persistent order storage. Set `DATA_DIR` to a persistent disk location or replace the file store with a database.

## Project Structure

```text
config/          Store configuration
docs/            Setup documentation
lib/             Order storage and fulfillment logic
public/          Website pages, styles, scripts, and media
server.js        Express server and API routes
.env.example     Configuration template
package.json     Dependencies and scripts
```

## Project Status

Countact is a product concept and demonstration project showcasing the proposed dispenser and companion app experience.
