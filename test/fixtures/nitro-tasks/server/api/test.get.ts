import { eventHandler } from 'h3'

export default eventHandler(async (event: any) => {
        return {
                status: 200,
                message: 'API is working',
        };
})
