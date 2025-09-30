export default defineEventHandler(async (event) => {
        const { result } = await runTask('example', {
    payload: { foo: 'bar' },
    context: { baz: 'qux' },
        })

  console.log('Task result:', result)
        return { success: true, data: result }
})
