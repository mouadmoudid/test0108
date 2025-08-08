import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/response'
import { reviewQuerySchema, validateQuery } from '@/lib/validations'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/admin/laundries/[laundryId]/reviews
export async function GET(
  request: NextRequest,
  { params }: { params: { laundryId: string } }
) {
  try {
    const { laundryId } = params
    const { searchParams } = new URL(request.url)
    const queryParams = Object.fromEntries(searchParams.entries())
    
    const validatedQuery = validateQuery(reviewQuerySchema, queryParams)
    if (!validatedQuery) {
      return errorResponse('Invalid query parameters', 400)
    }

    const { page, limit, rating, startDate, endDate } = validatedQuery

    // Provide default values if undefined
    const safePage = page ?? 1
    const safeLimit = limit ?? 10

    // Check if laundry exists
    const laundry = await prisma.laundry.findUnique({
      where: { id: laundryId }
    })

    if (!laundry) {
      return errorResponse('Laundry not found', 404)
    }

    // Calculate offset
    const offset = (safePage - 1) * safeLimit

    // Build where clause
    const whereClause: any = {
      laundryId: laundryId
    }

    // Add rating filter
    if (rating) {
      whereClause.rating = rating
    }

    // Add date range filter
    if (startDate || endDate) {
      whereClause.createdAt = {}
      if (startDate) {
        whereClause.createdAt.gte = new Date(startDate)
      }
      if (endDate) {
        whereClause.createdAt.lte = new Date(endDate)
      }
    }

    // Get reviews with pagination
    const [reviews, totalCount] = await Promise.all([
      prisma.review.findMany({
        where: whereClause,
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          updatedAt: true,
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true
            }
          },
          orderId: true
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),

      prisma.review.count({
        where: whereClause
      })
    ])

    // Get rating distribution for the laundry
    const ratingDistribution = await prisma.review.groupBy({
      by: ['rating'],
      where: { laundryId },
      _count: { rating: true },
      orderBy: { rating: 'asc' }
    })

    const totalPages = Math.ceil(totalCount / (limit ?? 10))

    // Format the response
    const formattedReviews = reviews.map(review => ({
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      customer: {
        id: review.customer.id,
        name: review.customer.name,
        email: review.customer.email,
        avatar: review.customer.avatar
      },
      orderId: review.orderId,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt
    }))

    // Calculate rating summary
    const ratingSummary = {
      averageRating: laundry.rating,
      totalReviews: laundry.totalReviews,
      distribution: Array.from({ length: 5 }, (_, i) => {
        const starRating = i + 1
        const found = ratingDistribution.find(r => r.rating === starRating)
        return {
          rating: starRating,
          count: found?._count.rating || 0,
          percentage: laundry.totalReviews > 0 
            ? Math.round(((found?._count.rating || 0) / laundry.totalReviews) * 100) 
            : 0
        }
      }).reverse() // Show 5 stars first
    }

    return NextResponse.json({
      success: true,
      message: 'Laundry reviews retrieved successfully',
      data: formattedReviews,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages
      },
      ratingSummary,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Laundry reviews error:', error)
    return errorResponse('Failed to retrieve laundry reviews', 500)
  }
}