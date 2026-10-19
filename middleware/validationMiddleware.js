import { z } from 'zod';

export const signupSchema = z.object({
    name: z.string().trim().min(2).max(255),
    email: z.string().trim().toLowerCase().email(),
    password: z
    .string()
    .trim()
    .min(8)
    .max(72)
    .regex(/[0-9]/, "Password must contain at least one number"),
});

export const loginSchema = z.object({
    email: z.string().trim().toLowerCase().email(),
    password: z
    .string()
    .min(1)
    .max(72)
});

export const getCourseParams =z.object({
    id: z.coerce.number().int().positive().max(2147483647),
});

export const listCourseQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().trim().max(100).optional(),
});

export const validate = (schema) => (req, res, next) => {
    const parsed = schema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            message: "Validation failed",
            errors: parsed.error.issues.map((issue) => ({
                field: issue.path.join("."),
                message: issue.message,
            })),
        });
    }

    req.body = parsed.data;
    next();
};