import ItemForm from "../ItemForm";

export default function NewItemPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Add Item</h1>
      <ItemForm />
    </div>
  );
}
