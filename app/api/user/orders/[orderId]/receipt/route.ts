// app/api/user/orders/[orderId]/receipt/route.ts - CUSTOMER uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOrderAccess, errorResponse } from '@/lib/auth-middleware'

export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  const authResult = await requireOrderAccess(request, params.orderId)
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  try {
    const order = await prisma.order.findUnique({
      where: { 
        id: params.orderId,
        status: { in: ['DELIVERED', 'COMPLETED'] } // Reçu disponible seulement pour les commandes terminées
      },
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                name: true,
                category: true,
                unit: true
              }
            }
          }
        },
        address: true,
        laundry: {
          select: {
            name: true,
            email: true,
            phone: true,
            addresses: {
              select: {
                street: true,
                city: true,
                state: true,
                zipCode: true
              },
              take: 1
            }
          }
        },
        customer: {
          select: {
            name: true,
            email: true,
            phone: true
          }
        }
      }
    })

    if (!order) {
      return errorResponse('Receipt not available for this order', 404)
    }

    // Générer le reçu en format JSON (peut être converti en PDF côté client)
    const receipt = {
      receiptNumber: `REC-${order.orderNumber}`,
      orderNumber: order.orderNumber,
      issueDate: new Date().toISOString(),
      
      // Informations de la laundry
      laundry: {
        name: order.laundry.name,
        email: order.laundry.email,
        phone: order.laundry.phone,
        address: order.laundry.addresses[0] || null
      },
      
      // Informations du client
      customer: {
        name: order.customer.name,
        email: order.customer.email,
        phone: order.customer.phone
      },
      
      // Adresse de livraison
      deliveryAddress: order.address,
      
      // Détails de la commande
      orderDetails: {
        orderDate: order.createdAt,
        deliveryDate: order.deliveryDate,
        status: order.status
      },
      
      // Articles
      items: order.orderItems.map((item, index) => ({
        line: index + 1,
        description: `${item.product.name} (${item.product.category})`,
        quantity: item.quantity,
        unit: item.product.unit,
        unitPrice: item.price,
        totalPrice: item.totalPrice
      })),
      
      // Calculs
      summary: {
        subtotal: order.totalAmount,
        deliveryFee: order.deliveryFee || 0,
        discount: order.discount || 0,
        finalAmount: order.finalAmount,
        paymentMethod: 'Cash on Delivery', // À adapter selon votre système de paiement
        paymentStatus: 'Paid'
      },
      
      // Notes légales
      footer: {
        thankYouMessage: "Merci pour votre confiance !",
        contactInfo: `Pour toute question, contactez-nous au ${order.laundry.phone} ou ${order.laundry.email}`,
        generatedAt: new Date().toISOString()
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Receipt generated successfully',
      data: receipt
    })
  } catch (error) {
    console.error('Generate receipt error:', error)
    return errorResponse('Failed to generate receipt', 500)
  }
}