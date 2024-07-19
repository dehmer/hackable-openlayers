import { render } from 'solid-js/web'
import Map from './components/Map.js'
import './index.scss'

const App = () => {
  return <div className='map-container'>
    <Map/>
    </div>
}

render(App, document.body)