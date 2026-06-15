declare module 'react-tradingview-widget' {
  import { ComponentType } from 'react'

  export interface TradingViewWidgetProps {
    symbol?: string
    theme?: 'Light' | 'Dark'
    locale?: string
    autosize?: boolean
    width?: number | string
    height?: number | string
    interval?: string
    timezone?: string
    style?: string
    toolbar_bg?: string
    enable_publishing?: boolean
    allow_symbol_change?: boolean
    withdateranges?: boolean
    hide_side_toolbar?: boolean
    hide_top_toolbar?: boolean
    hide_legend?: boolean
    save_image?: boolean
    details?: boolean
    hotlist?: boolean
    calendar?: boolean
    show_popup_button?: boolean
    popup_width?: string
    popup_height?: string
    studies?: string[]
    container_id?: string
    [key: string]: unknown
  }

  const TradingViewWidget: ComponentType<TradingViewWidgetProps>
  export default TradingViewWidget
}
