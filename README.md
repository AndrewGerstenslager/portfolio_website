# Portfolio Website - Retro Government Interface

A retro-futuristic portfolio website with a 3D interactive wireframe globe, styled like a government terminal interface.

## Features

- **3D Wireframe Globe**: Interactive globe made of triangles that rotates slowly and can be dragged/rotated
- **Retro Government Aesthetic**: Terminal-style interface with monospace fonts and green-on-black color scheme
- **Responsive Design**: Works on desktop and mobile devices
- **GitHub Pages Ready**: Configured for easy deployment

## Technologies Used

- HTML5
- CSS3 (with custom animations and effects)
- JavaScript
- Three.js (for 3D graphics)

## Deployment to GitHub Pages

1. Push this repository to GitHub
2. Go to your repository settings
3. Navigate to "Pages" in the left sidebar
4. Under "Source", select the branch (usually `main` or `master`)
5. Select the root folder (`/`)
6. Click "Save"
7. Your site will be available at `https://[username].github.io/[repository-name]`

## Local Development

Simply open `index.html` in a web browser, or use a local server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js (http-server)
npx http-server

# Using PHP
php -S localhost:8000
```

Then navigate to `http://localhost:8000` in your browser.

## Customization

- Edit `styles.css` to change colors, fonts, and styling
- Modify `globe.js` to adjust the 3D globe appearance and behavior
- Update `index.html` to add your own content and sections

## Browser Support

Works best in modern browsers that support:
- ES6 JavaScript
- CSS Grid and Flexbox
- WebGL (for Three.js)

