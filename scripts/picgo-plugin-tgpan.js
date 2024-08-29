module.exports = (ctx) => {
  const register = () => {
    ctx.helper.uploader.register('tgpan', {
      handle,
      name: 'tgpan',
      config: config
    })
  }

  const handle = async (ctx) => {
    let url = ctx.config.tgpan.url
    if (!url) {
      throw new Error('tgpan URL is not configured')
    }
    try {
      const res = await ctx.Request.request({
        method: 'POST',
        url: url + '/api/pic',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: ctx.output
      })
      if (!res.downloadUrl) {
        throw new Error('Upload failed')
      }
      return res.downloadUrl
    } catch (err) {
      ctx.emit('notification', {
        title: 'Upload failed',
        body: err.message
      })
      throw err
    }
  }

  const config = ctx => {
    let userConfig = ctx.getConfig('picBed.tgpan')
    if (!userConfig) {
      userConfig = {}
    }
    return [
      {
        name: 'url',
        type: 'input',
        default: userConfig.url || '',
        required: true
      }
    ]
  }
}
