import p5 from 'p5'
import { render } from 'preact'
import { App } from './app'
import { createSketch } from './sketch'
import { createGenerationModel, getGeneration } from './generation-state'
import './style.css'

const generation = getGeneration()
const model = createGenerationModel(generation)
const app = document.getElementById('app')!
const instance = new p5(createSketch(generation), app)

const panel = document.createElement('div')
document.body.insertBefore(panel, app)
render(<App model={model} />, panel)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    instance.remove()
  })
}
