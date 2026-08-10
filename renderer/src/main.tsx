import React from 'react'
import ReactDOM from 'react-dom/client'
import { installBridge } from './lib/bridge'
import { initPerf, mark } from './lib/perf'
import { initWheelSmoothing } from './lib/wheel-smooth'
import './fonts.css'
import App from './app/App'
import { applyCachedStartPageRoute } from './app/route-loaders'
import './globals.css'
import './manifold.css'

// Earliest measurable point in bundle evaluation (fetch/parse of the bundle
// precedes it; performance.timeOrigin is the page navigation start).
mark('main:bundle-eval')
installBridge()
applyCachedStartPageRoute()
mark('main:pre-render')
void initPerf()
initWheelSmoothing()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
