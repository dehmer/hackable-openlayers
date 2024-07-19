import { onMount } from 'solid-js'
import Map from '../ol/Map.js'
import OSM from '../ol/source/OSM.js'
import TileLayer from '../ol/layer/Tile.js'
import View from '../ol/View.js'
import '../ol/ol.css'
import './Map.scss'

const Component = () => {
  onMount(() => {
    const source = new OSM()
    const layers = [new TileLayer({ source })]
    const center = [1823376.75753279, 6143598.472197734]
    const resolution = 128
    const view = new View({ center, resolution })
    new Map({ layers, view, target: 'map' })
  })

  return (
    <div
      id='map'
      className='map'
      tabIndex='0'
    />
  )
}

export default Component
