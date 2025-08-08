import { NextResponse } from 'next/server'

export function successResponse(data: any, message = 'Success', status = 200) {
  return NextResponse.json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString()
  }, { status })
}

export function errorResponse(message: string, status = 400, errors: any = null) {
  return NextResponse.json({
    success: false,
    message,
    errors,
    timestamp: new Date().toISOString()
  }, { status })
}

export function paginatedResponse(
  data: any[],
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  },
  message = 'Success'
) {
  return NextResponse.json({
    success: true,
    message,
    data,
    pagination,
    timestamp: new Date().toISOString()
  })
}