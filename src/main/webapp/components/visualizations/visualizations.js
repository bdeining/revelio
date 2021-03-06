import React, { useState, useEffect } from 'react'
import { featureCollection, centerOfMass, getCoord } from '@turf/turf'

import Button from '@material-ui/core/Button'
import Menu from '@material-ui/core/Menu'
import MenuItem from '@material-ui/core/MenuItem'

import { useSelectionInterface, useDrawInterface } from '../../react-hooks'

import { Layout, Provider, AddConfig, DragSource } from '../react-golden-layout'

import Histogram from '../histogram/histogram'
import Inspector from '../inspector/inspector'
import ResultTable from '../results/results'
import Gallery from '../gallery'

import {
  ClusterMap,
  RENDERER_STYLE,
  DRAWING_STYLE,
  withDrawMenu,
} from '../maps'
import WKT from 'ol/format/WKT'
import GeoJSON from 'ol/format/GeoJSON'
import { geoJSONToGeometryJSON } from 'geospatialdraw/bin/geometry/utilities'
import { LAT_LON } from 'geospatialdraw/bin/coordinates/units'
import { Set } from 'immutable'

const MapComponent = withDrawMenu(ClusterMap)

const AddVisualization = () => {
  const [anchorEl, setAnchorEl] = useState(null)

  const handleClick = event => {
    setAnchorEl(event.currentTarget)
  }

  const handleClose = () => {
    setAnchorEl(null)
  }

  const options = {
    '2D Map': {
      type: 'component',
      title: '2D Map',
      componentName: '2d-map',
    },
    Table: {
      type: 'component',
      title: 'Table',
      componentName: 'table',
    },
    Inspector: {
      type: 'component',
      title: 'Inspector',
      componentName: 'inspector',
    },
    Histogram: {
      type: 'component',
      title: 'Histogram',
      componentName: 'histogram',
    },
    Gallery: {
      type: 'component',
      title: 'Gallery',
      componentName: 'gallery',
    },
  }

  return (
    <div style={{ position: 'absolute', bottom: 10, right: 10 }}>
      <Button
        aria-controls="simple-menu"
        aria-haspopup="true"
        onClick={handleClick}
        color="primary"
        variant="contained"
      >
        Add Visual
      </Button>
      <Menu
        id="simple-menu"
        anchorEl={anchorEl}
        keepMounted
        open={Boolean(anchorEl)}
        onClose={handleClose}
      >
        {Object.keys(options).map(option => {
          const config = options[option]

          return (
            <MenuItem key={option} onClick={() => handleClose(option)}>
              <DragSource config={config}>
                <AddConfig config={config}>{option}</AddConfig>
              </DragSource>
            </MenuItem>
          )
        })}
      </Menu>
    </div>
  )
}

const config = {
  content: [
    {
      type: 'row',
      content: [
        {
          type: 'component',
          title: 'Table',
          componentName: 'table',
        },
      ],
    },
  ],
}

const VisContainer = ({ children }) => {
  return (
    <div
      style={{
        padding: 20,
        boxSizing: 'border-box',
        overflow: 'auto',
        height: '100%',
        width: '100%',
      }}
    >
      {children}
    </div>
  )
}

const Visualizations = props => {
  const { results } = props

  const InspectorVis = () => {
    const [selected] = useSelectionInterface()

    const selectedResults = results.filter(result => {
      return selected.has(result.metacard.attributes.id)
    })

    return (
      <VisContainer>
        <Inspector results={selectedResults} />
      </VisContainer>
    )
  }

  const TableVis = () => {
    return (
      <VisContainer>
        <ResultTable
          attributes={['id', 'title', 'created']}
          results={results}
        />
      </VisContainer>
    )
  }

  const GalleryVis = () => {
    return (
      <VisContainer>
        <Gallery results={results} />
      </VisContainer>
    )
  }

  const HistogramVis = () => {
    const [selected, onSelect] = useSelectionInterface()

    const selectedResults = results.filter(result => {
      return selected.has(result.metacard.attributes.id)
    })

    return (
      <VisContainer>
        <Histogram
          results={results}
          selected={selectedResults}
          onSelect={onSelect}
        />
      </VisContainer>
    )
  }

  const wkt = new WKT({ splitCollection: true })
  const geoJSON = new GeoJSON()
  const MapVis = () => {
    const PROJECTION = 'EPSG:4326'
    const [selection, onSelect] = useSelectionInterface()
    const [originalGeo, setOriginalGeo] = useState(null)
    const [
      { geo: drawGeo, shape, active: isDrawing },
      setDrawState,
    ] = useDrawInterface()
    useEffect(
      () => {
        if (isDrawing) {
          setOriginalGeo(drawGeo)
        }
      },
      [isDrawing]
    )
    const geos = results
      .map(
        result =>
          result.metacard.attributes.location
            ? wkt
                .readFeatures(result.metacard.attributes.location)
                .map(locationGeo => {
                  const featureGeo = geoJSON.writeFeatureObject(locationGeo)
                  return geoJSONToGeometryJSON(result.metacard.attributes.id, {
                    ...featureGeo,
                    properties: {
                      ...featureGeo.properties,
                      selected: selection.has(result.metacard.attributes.id),
                    },
                  })
                })
            : []
      )
      .reduce((list, value) => list.concat(value), [])
    const selectedGeos = geos.filter(g => g.properties.selected)
    const center =
      isDrawing && originalGeo
        ? getCoord(centerOfMass(originalGeo))
        : selectedGeos.length > 0
          ? getCoord(centerOfMass(featureCollection(selectedGeos)))
          : null
    return (
      <MapComponent
        projection={PROJECTION}
        mapStyle={RENDERER_STYLE}
        drawStyle={DRAWING_STYLE}
        coordinateType={LAT_LON}
        maxZoom={20}
        minZoom={1.5}
        zoom={2}
        geos={geos}
        center={center}
        selectGeos={ids => {
          if (!isDrawing) {
            onSelect(Set(ids))
          }
        }}
        isDrawing={isDrawing}
        drawShape={shape}
        drawGeo={isDrawing ? drawGeo : null}
        onSetShape={update => {
          setDrawState({
            geo: null,
            active: true,
            shape: update,
          })
        }}
        onUpdate={update => {
          setDrawState({
            geo: update,
            active: true,
            shape: update.properties.shape,
          })
        }}
        onCancel={() => {
          setDrawState({
            geo: originalGeo,
            active: false,
            shape: originalGeo.properties.shape,
          })
        }}
        onOk={() => {
          setDrawState({
            geo: drawGeo,
            active: false,
            shape,
          })
        }}
      />
    )
  }

  const components = {
    inspector: InspectorVis,
    table: TableVis,
    '2d-map': MapVis,
    histogram: HistogramVis,
    gallery: GalleryVis,
  }
  return (
    <Provider>
      <div style={{ position: 'relative', height: '100%' }}>
        <Layout
          config={config}
          components={components}
          onChange={() => {
            /*console.log(config)*/
          }}
        />
        <AddVisualization />
      </div>
    </Provider>
  )
}

export default React.memo(Visualizations)
