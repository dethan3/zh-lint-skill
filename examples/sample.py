#!/usr/bin/env python3
# 示例文件：包含各种常见中文错误

def process_order(order_id):
    # 这个函数用来处理订单
    # 根据订单ID获取订单信息
    order = get_order(order_id)
    if not order:
        return "订单不正确，请重新输入"
    return "处理成功"


class OrderService:
    """订单服务类，用来管理订单的增删改查操作。"""

    def create_order(self, user_id, items):
        # 创建一个新订单
        # user_id: 用户ID
        # items: 订单项列表
        pass

    def get_order(self, order_id):
        # 根据订单ID获取订单信息
        # 如果订单不存在，返回 None
        pass


# 这个函数的功能是发送通知给指定的用户
# 参数包括：用户ID、通知类型、通知内容
def send_notification(user_id, type, content):
    # 这个方法使我们能够发送通知
    pass


# 数据验证函数
def validate_data(data):
    # 检查数据是否符合要求
    # 如果数据无效，抛出异常
    if not data:
        raise ValueError("数据不能为空")
    return True
