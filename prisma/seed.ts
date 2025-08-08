import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting seed...')

  // Clear existing data in development
  if (process.env.NODE_ENV !== 'production') {
    await prisma.activity.deleteMany()
    await prisma.review.deleteMany()
    await prisma.orderItem.deleteMany()
    await prisma.order.deleteMany()
    await prisma.product.deleteMany()
    await prisma.address.deleteMany()
    await prisma.laundry.deleteMany()
    await prisma.user.deleteMany()
    await prisma.analytics.deleteMany()
    console.log('🧹 Cleared existing data')
  }

  // Create Super Admin
  const superAdmin = await prisma.user.create({
    data: {
      email: 'superadmin@laundry.com',
      name: 'Super Admin',
      phone: '+212600000000',
      role: 'SUPER_ADMIN',
      avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=face'
    }
  })

  // Create Customers
  const customers = await Promise.all([
    prisma.user.create({
      data: {
        email: 'ahmed.hassan@gmail.com',
        name: 'Ahmed Hassan',
        phone: '+212661234567',
        role: 'CUSTOMER',
        avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face'
      }
    }),
    prisma.user.create({
      data: {
        email: 'fatima.zahra@gmail.com',
        name: 'Fatima Zahra',
        phone: '+212662345678',
        role: 'CUSTOMER',
        avatar: 'https://images.unsplash.com/photo-1494790108755-2616b612a78a?w=150&h=150&fit=crop&crop=face'
      }
    }),
    prisma.user.create({
      data: {
        email: 'youssef.benali@gmail.com',
        name: 'Youssef Benali',
        phone: '+212663456789',
        role: 'CUSTOMER',
        avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop&crop=face'
      }
    }),
    prisma.user.create({
      data: {
        email: 'sara.alami@gmail.com',
        name: 'Sara Alami',
        phone: '+212664567890',
        role: 'CUSTOMER',
        avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&h=150&fit=crop&crop=face'
      }
    })
  ])

  // Create Laundry Admins
  const laundryAdmins = await Promise.all([
    prisma.user.create({
      data: {
        email: 'admin@cleanpro.ma',
        name: 'Mohamed Tazi',
        phone: '+212665678901',
        role: 'ADMIN',
        avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=face'
      }
    }),
    prisma.user.create({
      data: {
        email: 'admin@sparklewash.ma',
        name: 'Laila Bennani',
        phone: '+212666789012',
        role: 'ADMIN',
        avatar: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=150&h=150&fit=crop&crop=face'
      }
    }),
    prisma.user.create({
      data: {
        email: 'admin@quickclean.ma',
        name: 'Omar Essaidi',
        phone: '+212667890123',
        role: 'ADMIN',
        avatar: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150&h=150&fit=crop&crop=face'
      }
    })
  ])

  // Create Customer Addresses
  await Promise.all(customers.map((customer, index) => 
    prisma.address.create({
      data: {
        street: `${100 + index * 50} Avenue Mohammed V`,
        city: index % 2 === 0 ? 'Casablanca' : 'Rabat',
        state: 'Casablanca-Settat',
        zipCode: `20${100 + index}0`,
        country: 'Morocco',
        isDefault: true,
        latitude: 33.5731 + (Math.random() - 0.5) * 0.1,
        longitude: -7.5898 + (Math.random() - 0.5) * 0.1,
        userId: customer.id
      }
    })
  ))

  // Create Laundries
  const laundries = await Promise.all([
    prisma.laundry.create({
      data: {
        name: 'CleanPro Laundry',
        email: 'contact@cleanpro.ma',
        phone: '+212520123456',
        description: 'Professional laundry service with eco-friendly cleaning solutions',
        logo: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=300&h=200&fit=crop',
        status: 'ACTIVE',
        rating: 4.8,
        totalReviews: 156,
        totalOrders: 1250,
        totalRevenue: 87500.50,
        adminId: laundryAdmins[0].id,
        operatingHours: {
          monday: { open: '08:00', close: '18:00', closed: false },
          tuesday: { open: '08:00', close: '18:00', closed: false },
          wednesday: { open: '08:00', close: '18:00', closed: false },
          thursday: { open: '08:00', close: '18:00', closed: false },
          friday: { open: '14:00', close: '18:00', closed: false },
          saturday: { open: '08:00', close: '16:00', closed: false },
          sunday: { open: '09:00', close: '15:00', closed: false }
        }
      }
    }),
    prisma.laundry.create({
      data: {
        name: 'Sparkle Wash',
        email: 'info@sparklewash.ma',
        phone: '+212520234567',
        description: 'Quick and reliable laundry service for busy professionals',
        logo: 'https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?w=300&h=200&fit=crop',
        status: 'ACTIVE',
        rating: 4.5,
        totalReviews: 89,
        totalOrders: 650,
        totalRevenue: 45200.75,
        adminId: laundryAdmins[1].id,
        operatingHours: {
          monday: { open: '07:00', close: '19:00', closed: false },
          tuesday: { open: '07:00', close: '19:00', closed: false },
          wednesday: { open: '07:00', close: '19:00', closed: false },
          thursday: { open: '07:00', close: '19:00', closed: false },
          friday: { open: '14:00', close: '19:00', closed: false },
          saturday: { open: '08:00', close: '17:00', closed: false },
          sunday: { open: '00:00', close: '00:00', closed: true }
        }
      }
    }),
    prisma.laundry.create({
      data: {
        name: 'Quick Clean Express',
        email: 'hello@quickclean.ma',
        phone: '+212520345678',
        description: 'Express laundry service with same-day delivery',
        logo: 'https://images.unsplash.com/photo-1545558014-8692077e9b5c?w=300&h=200&fit=crop',
        status: 'ACTIVE',
        rating: 4.2,
        totalReviews: 42,
        totalOrders: 320,
        totalRevenue: 22150.25,
        adminId: laundryAdmins[2].id,
        operatingHours: {
          monday: { open: '09:00', close: '17:00', closed: false },
          tuesday: { open: '09:00', close: '17:00', closed: false },
          wednesday: { open: '09:00', close: '17:00', closed: false },
          thursday: { open: '09:00', close: '17:00', closed: false },
          friday: { open: '14:00', close: '17:00', closed: false },
          saturday: { open: '09:00', close: '15:00', closed: false },
          sunday: { open: '00:00', close: '00:00', closed: true }
        }
      }
    })
  ])

  // Create Laundry Addresses
  await Promise.all(laundries.map((laundry, index) =>
    prisma.address.create({
      data: {
        street: `${200 + index * 100} Boulevard Zerktouni`,
        city: 'Casablanca',
        state: 'Casablanca-Settat',
        zipCode: `20${200 + index}0`,
        country: 'Morocco',
        latitude: 33.5731 + (Math.random() - 0.5) * 0.05,
        longitude: -7.5898 + (Math.random() - 0.5) * 0.05,
        userId: laundry.adminId,
        laundryId: laundry.id
      }
    })
  ))

  // Create Products/Services for each laundry
  const products = []
  for (const laundry of laundries) {
    const laundryProducts = await Promise.all([
      prisma.product.create({
        data: {
          name: 'Wash & Fold',
          description: 'Basic washing and folding service',
          price: 25.00,
          unit: 'kg',
          category: 'washing',
          laundryId: laundry.id
        }
      }),
      prisma.product.create({
        data: {
          name: 'Dry Cleaning',
          description: 'Professional dry cleaning for delicate items',
          price: 80.00,
          unit: 'piece',
          category: 'dry_cleaning',
          laundryId: laundry.id
        }
      }),
      prisma.product.create({
        data: {
          name: 'Ironing Service',
          description: 'Professional ironing and pressing',
          price: 15.00,
          unit: 'piece',
          category: 'ironing',
          laundryId: laundry.id
        }
      }),
      prisma.product.create({
        data: {
          name: 'Bed Linen Cleaning',
          description: 'Specialized cleaning for bed sheets and pillowcases',
          price: 35.00,
          unit: 'set',
          category: 'washing',
          laundryId: laundry.id
        }
      }),
      prisma.product.create({
        data: {
          name: 'Curtain Cleaning',
          description: 'Deep cleaning for curtains and drapes',
          price: 120.00,
          unit: 'piece',
          category: 'specialized',
          laundryId: laundry.id
        }
      })
    ])
    products.push(...laundryProducts)
  }

  // Create Orders
  const orders = []
  const statuses = ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'DELIVERED', 'CANCELED']
  
  for (let i = 0; i < 50; i++) {
    const customer = customers[Math.floor(Math.random() * customers.length)]
    const laundry = laundries[Math.floor(Math.random() * laundries.length)]
    const laundryProducts = products.filter(p => p.laundryId === laundry.id)
    
    const customerAddress = await prisma.address.findFirst({
      where: { userId: customer.id }
    })

    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-${Date.now()}-${i.toString().padStart(3, '0')}`,
        status: statuses[Math.floor(Math.random() * statuses.length)] as any,
        totalAmount: 0, // Will calculate after items
        deliveryFee: 15.00,
        discount: Math.random() > 0.7 ? 10.00 : 0,
        finalAmount: 0, // Will calculate after items
        notes: Math.random() > 0.5 ? 'Please handle with care' : null,
        pickupDate: new Date(Date.now() + Math.random() * 7 * 24 * 60 * 60 * 1000),
        deliveryDate: new Date(Date.now() + Math.random() * 14 * 24 * 60 * 60 * 1000),
        customerId: customer.id,
        laundryId: laundry.id,
        addressId: customerAddress!.id,
        createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000) // Random date in last 30 days
      }
    })

    // Create order items
    const numItems = Math.floor(Math.random() * 3) + 1
    let totalAmount = 0

    for (let j = 0; j < numItems; j++) {
      const product = laundryProducts[Math.floor(Math.random() * laundryProducts.length)]
      const quantity = Math.floor(Math.random() * 5) + 1
      const totalPrice = product.price * quantity
      totalAmount += totalPrice

      await prisma.orderItem.create({
        data: {
          quantity,
          price: product.price,
          totalPrice,
          orderId: order.id,
          productId: product.id
        }
      })
    }

    // Update order with calculated amounts
    const finalAmount = totalAmount + order.deliveryFee - order.discount
    await prisma.order.update({
      where: { id: order.id },
      data: {
        totalAmount,
        finalAmount
      }
    })

    orders.push(order)
  }

  // Create Reviews
  for (let i = 0; i < 30; i++) {
    const customer = customers[Math.floor(Math.random() * customers.length)]
    const laundry = laundries[Math.floor(Math.random() * laundries.length)]
    const rating = Math.floor(Math.random() * 5) + 1
    
    const comments = [
      'Great service! Very satisfied with the quality.',
      'Quick and professional. Will use again.',
      'Excellent cleaning quality and on-time delivery.',
      'Staff was very helpful and friendly.',
      'Good value for money. Recommended!',
      'Could be better, but overall satisfied.',
      'Outstanding service! Exceeded expectations.',
      null // Some reviews without comments
    ]

    await prisma.review.create({
      data: {
        rating,
        comment: comments[Math.floor(Math.random() * comments.length)],
        customerId: customer.id,
        laundryId: laundry.id,
        createdAt: new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000) // Random date in last 60 days
      }
    })
  }

  // Create Activities
  const activityTypes = ['ORDER_CREATED', 'ORDER_UPDATED', 'ORDER_COMPLETED', 'ORDER_CANCELED', 'REVIEW_ADDED', 'LAUNDRY_REGISTERED']
  
  for (let i = 0; i < 100; i++) {
    const type = activityTypes[Math.floor(Math.random() * activityTypes.length)]
    const laundry = laundries[Math.floor(Math.random() * laundries.length)]
    const customer = customers[Math.floor(Math.random() * customers.length)]
    const order = orders[Math.floor(Math.random() * orders.length)]

    await prisma.activity.create({
      data: {
        type: type as any,
        title: `${type.replace('_', ' ')} Activity`,
        description: `Activity related to ${type.toLowerCase().replace('_', ' ')}`,
        userId: Math.random() > 0.5 ? customer.id : undefined,
        laundryId: laundry.id,
        orderId: type.includes('ORDER') ? order.id : undefined,
        createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000)
      }
    })
  }

  console.log('✅ Seed completed successfully!')
  console.log(`Created:
  - 1 Super Admin
  - ${customers.length} Customers  
  - ${laundryAdmins.length} Laundry Admins
  - ${laundries.length} Laundries
  - ${products.length} Products/Services
  - ${orders.length} Orders
  - 30 Reviews
  - 100 Activities`)
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })